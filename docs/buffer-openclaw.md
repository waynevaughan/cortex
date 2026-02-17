# Buffer for OpenClaw

How to implement the Buffer protocol in [OpenClaw](https://openclaw.ai). This guide maps each Buffer requirement to the specific OpenClaw mechanisms that fulfill it.

**Prerequisites:** Read the [Buffer spec](../spec/buffer.md) first. This guide assumes you understand the protocol.

---

## Overview

OpenClaw provides most of Buffer's infrastructure out of the box — context windows, session persistence, heartbeats, and compaction. What you configure is: bootstrap files, monitoring thresholds, the wrap procedure, and continuity files.

---

## 1. Bootstrap Loading

OpenClaw automatically injects workspace files into the agent's context at session start. Place your bootstrap files in the workspace directory (`~/.openclaw/workspace/` by default).

### Required Files

| File | Purpose | Notes |
|---|---|---|
| `AGENTS.md` | Operating rules, session protocol | Define wrap procedure, tool discipline, safety rules |
| `SOUL.md` | Agent identity and persona | How the agent communicates |
| `USER.md` | Owner preferences | Work hours, communication style, autonomy level |
| `MEMORY.md` | Standing briefing (~1.5KB max) | This week, priorities, projects, key people |
| `HANDOFF.md` | Session continuity | Overwritten every wrap — stopping point, next steps |

### Optional Files

| File | Purpose |
|---|---|
| `HEARTBEAT.md` | Instructions for periodic health checks |
| `TOOLS.md` | Tool-specific notes and workarounds |
| `BOOTSTRAP.md` | Explicit startup procedure (read messages, announce orientation) |

### Injection Limits

Each workspace file has a 20K character injection limit. Keep files concise — MEMORY.md should be under 1.5KB, HANDOFF.md under 3KB. If a file exceeds the limit, it's truncated silently.

All files are injected simultaneously with no priority ordering. Use structural emphasis (headers, bold, placement) to signal importance.

---

## 2. Context Monitoring

### The Heartbeat

OpenClaw's heartbeat is the monitoring mechanism. The gateway injects a system message into the agent session on a configurable interval.

**Configuration** (in `~/.openclaw/config.yaml`):

```yaml
heartbeat:
  intervalMs: 180000  # 3 minutes
```

### What the Heartbeat Checks

Define monitoring instructions in `HEARTBEAT.md`. The heartbeat prompt tells the agent what to check and how to respond:

- **Below 80% of operational cap:** Reply `HEARTBEAT_OK` (no action needed)
- **At 80%:** Warn the user that context is getting high
- **At 85%:** Begin wrap immediately — no confirmation, no deferral

### Checking Context Occupancy

Use the local API endpoint to get actual context window usage:

```bash
curl -s http://127.0.0.1:8111/api/context
```

**Do not use `session_status` for context monitoring.** It reports cumulative tokens (all tokens ever used), not actual window occupancy. The `/api/context` endpoint reports real occupancy.

---

## 3. Session Reset

This is the most important implementation detail in OpenClaw. Getting it wrong means sessions don't actually reset.

### How OpenClaw Sessions Work

Sessions are persisted to disk in `~/.openclaw/agents/main/sessions/sessions.json`. Each session has a key (e.g., `agent:main:discord:channel:123456`) and a transcript file.

**Gateway restart (`SIGUSR1`) does NOT reset sessions.** It reloads config and skills only. Session state (including the full conversation transcript) survives restarts.

To get a fresh context window, you must **delete the session entry** from `sessions.json`. OpenClaw creates a new session (new ID, empty context) on the next inbound message.

### The Wrap Script

Create `tools/session-wrap.sh` in your workspace:

```bash
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="$HOME/.openclaw/workspace"
SESSIONS_FILE="$HOME/.openclaw/agents/main/sessions/sessions.json"
COMMIT_MSG="${1:?Usage: session-wrap.sh <commit-message> <session-key>}"
SESSION_KEY="${2:?Usage: session-wrap.sh <commit-message> <session-key>}"

cd "$WORKSPACE"

# Pre-flight validation
if [ ! -s HANDOFF.md ]; then
    echo "ERROR: HANDOFF.md is empty or missing" >&2
    exit 1
fi
if ! grep -q "Next Steps" HANDOFF.md; then
    echo "ERROR: HANDOFF.md missing 'Next Steps' section" >&2
    exit 1
fi
if [ ! -s MEMORY.md ]; then
    echo "ERROR: MEMORY.md is empty or missing" >&2
    exit 1
fi

# 1. Git commit
if git diff --quiet && git diff --cached --quiet; then
    echo "Nothing to commit"
else
    git add -A && git commit -m "$COMMIT_MSG"
    echo "✓ Committed: $COMMIT_MSG"
fi

# 2. Delete session entry
python3 -c "
import json
path = '$SESSIONS_FILE'
key = '$SESSION_KEY'
d = json.load(open(path))
if key in d:
    del d[key]
    json.dump(d, open(path, 'w'), indent=2)
    print(f'✓ Deleted session: {key}')
else:
    print('⚠ Session not found (already clean)')
"
```

The script does two things: commits state to git, then deletes the session so the next message starts fresh. It does NOT restart the gateway — that's a separate step.

### The Full Wrap Sequence

From the agent's perspective, the wrap is:

```
Steps 1-6:  Write daily log, MEMORY.md, HANDOFF.md (per Buffer protocol)
Step 7:     Pre-flight checklist (verify files are written)
Step 8:     Run: bash tools/session-wrap.sh "<message>" "<session-key>"
Step 9:     Schedule a bootstrap ping (cron job ~15s in the future)
Step 10:    gateway action=restart
```

**Step 9 matters.** After restart, the new session sits idle until it receives a message. The bootstrap ping — a one-shot cron job — sends a system event that triggers the new session to announce itself and reorient.

**Step 10 is the last thing the agent does.** No further turns are possible after the restart.

### Finding the Session Key

The agent can find its session key via `sessions_list`. The key format is:
```
agent:main:<channel>:<channel-type>:<channel-id>
```
Example: `agent:main:discord:channel:1470820351674945606`

---

## 4. Continuity Files

### HANDOFF.md

The most important file in the system. Overwritten every wrap. Structure:

```markdown
# HANDOFF.md
<!-- Last updated: YYYY-MM-DD ~HH:MM TZ -->

## Current Work
What was being worked on.

## Stopping Point
Exact state when work stopped. Be specific — file names, line numbers, section names.

## Files Modified This Session
List of files changed, with what changed.

## Next Steps
1. First priority — with enough context to start cold
2. Second priority
3. ...

## Open Questions
Anything unresolved that needs the user's input.

## Owner Directives
Anything the user said to remember across sessions.
```

**Rules:**
- Overwrite, don't append. HANDOFF.md is saved registers, not a log.
- Be specific. "Continue the review" is useless. "Resume vault.md review at Decay section" is useful.
- Include file paths. The next session shouldn't have to search for what you were editing.

### MEMORY.md

Standing briefing. Updated incrementally. Hard limit: 1.5KB (1536 bytes).

```markdown
# MEMORY.md — Agent Briefing
<!-- MAX 1.5KB. Update data only. -->
<!-- Last: YYYY-MM-DD HH:MM TZ -->

## This Week
- Key events and accomplishments

## Priorities
1. Current top priority
2. Second priority
3. ...

## Projects
- **Project A** — status, next action
- **Project B** — status, next action

## Key People
- **Name** — role, relevant context
```

**Rules:**
- Every word earns its place. This is a briefing, not a journal.
- Update at every wrap, even if nothing changed (verify it's still accurate).
- Check byte count: `wc -c MEMORY.md`

### Daily Logs

Append-only files at `memory/YYYY-MM-DD.md`. Each wrap appends a session summary. These serve as:
- Durable fallback if HANDOFF.md is lost
- Historical record of what was done when
- Context for the agent if it needs to look back

Include a "Next Session Startup" section at the end of each entry as a compact fallback for HANDOFF.md.

---

## 5. Compaction Settings

OpenClaw's auto-compaction fires when context reaches the emergency threshold. Configure it so the emergency threshold sits just above the wrap-complete threshold:

- Wrap threshold: 85% of operational cap
- Complete threshold: 90% of operational cap
- Compaction: ~100% of operational cap

The gap should be small. If compaction fires during normal operations, it means the heartbeat monitoring and wrap procedure both failed.

### Pre-Compaction Flush

OpenClaw fires a pre-compaction memory flush — a silent agent turn prompting the agent to write state before compaction occurs. This is the last safety net before context is destroyed.

### Post-Compaction Recovery

After compaction, the agent sees a compacted context. Bootstrap files (HANDOFF.md, MEMORY.md) are still in the workspace and can be re-read. The agent reorients from these files.

Recovery is imperfect — details from the compacted context are lost. Prevention (wrapping on time) is always better than recovery.

---

## Quick Start

1. Create workspace files: `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `HANDOFF.md`
2. Create `HEARTBEAT.md` with context monitoring instructions
3. Create `tools/session-wrap.sh` (script above)
4. Configure heartbeat interval in OpenClaw config
5. Add the wrap procedure to `AGENTS.md` so the agent knows how to execute it
6. Test: fill context to 85%, verify the agent wraps automatically

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Session doesn't reset after wrap | Gateway restart doesn't clear sessions | Verify `session-wrap.sh` is deleting from `sessions.json` |
| New session starts without context | HANDOFF.md empty or missing | Check pre-flight validation in wrap script |
| Agent doesn't auto-wrap | Heartbeat not configured or HEARTBEAT.md missing | Verify heartbeat interval and monitoring instructions |
| Context monitoring shows wrong numbers | Using `session_status` instead of `/api/context` | Switch to the API endpoint for real occupancy |
| Compaction fires during normal work | Wrap threshold too close to compaction threshold, or agent ignoring heartbeat | Widen the gap; make auto-wrap non-negotiable in HEARTBEAT.md |
| New session sits idle after wrap | No bootstrap ping scheduled | Add the cron job (Step 9) before gateway restart |
