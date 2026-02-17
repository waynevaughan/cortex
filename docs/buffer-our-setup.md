# Buffer — Our Setup

How the Buffer protocol is implemented on Wayne's system. Every detail, from the API header that unlocks 1M context to the exact files on disk.

**Last updated:** 2026-02-17

---

## System

| Component | Value |
|---|---|
| Machine | Mac mini (Apple Silicon, arm64) |
| OS | macOS 26.2 |
| Platform | OpenClaw 2026.2.13 (stable channel) |
| Model | Anthropic Claude Opus 4.6 |
| Node | v25.5.0 |
| Gateway | LaunchAgent service, always running |
| Dashboard | `http://127.0.0.1:18789/` |
| Tailscale | `admins-mac-mini.tail87b380.ts.net` |
| Workspace | `~/.openclaw/workspace/` |
| Sessions store | `~/.openclaw/agents/main/sessions/sessions.json` |

---

## The 1M Context Window

**Critical detail:** Opus 4.6 defaults to a 200K input token limit. The 1M context window requires a beta header:

```
anthropic-beta: context-1m-2025-08-07
```

Without this header, Anthropic enforces the 200K default. OpenClaw reports `contextTokens: 1000000` for the session but if the header isn't sent, the API rejects prompts at 200K. Compaction never triggers because OpenClaw thinks it has 800K of headroom.

**Symptoms of missing header:** Session crashes at ~200K tokens with `prompt is too long: 200178 tokens > 200000 maximum`. Dashboard shows ~39% utilization (200K of 500K cap) but the session dies anyway.

**The fix:** OpenClaw must send the beta header on every Anthropic API call. This was filed as [OpenClaw #18771](https://github.com/openclaw/openclaw/issues/18771) and fixed.

**Current state:** Header is active. Full 1M context window available. Operational cap set at 500K (50% of 1M).

---

## Context Thresholds

| Threshold | Absolute Value | Action |
|---|---|---|
| Operational cap | 500K tokens (50% of 1M) | Maximum usable context |
| Warn | 400K (80% of cap) | Alert Wayne: "Context at X%, wrapping soon" |
| Wrap | 425K (85% of cap) | Begin wrap immediately, no deferral |
| Complete | 450K (90% of cap) | Wrap must be finished |
| Emergency | ~500K (100% of cap) | Auto-compaction fires |

---

## Heartbeat

The heartbeat is OpenClaw's monitoring mechanism. Configured at 3-minute intervals for the main agent.

| Agent | Heartbeat |
|---|---|
| main (Cole) | 3 minutes |
| builder | disabled |
| devops | disabled |
| jena | disabled |
| worker | disabled |

The heartbeat injects a system message into the session. The agent's `HEARTBEAT.md` file contains instructions for what to check and how to respond.

**Current state:** `HEARTBEAT.md` is empty (0 bytes). The heartbeat fires but the agent has no monitoring instructions. Context monitoring relies on the agent's built-in rules from `AGENTS.md` rather than explicit heartbeat instructions.

**TODO:** Write `HEARTBEAT.md` with explicit context monitoring instructions.

---

## Bootstrap Files

Located at `~/.openclaw/workspace/`. Injected into context at session start. 20K character injection limit per file.

| File | Size | Status | Purpose |
|---|---|---|---|
| `AGENTS.md` | 2.8KB | Active | Operating rules, context management, model routing, safety, wrap procedure reference |
| `SOUL.md` | 876B | Active | Agent identity — first person as Cole Clawson, direct/warm/sharp persona |
| `USER.md` | 202B | Active | Wayne's info — work hours (9AM-3:30PM CT), autonomy level, Telegram handle |
| `MEMORY.md` | 1.5KB | Active | Standing briefing — this week, priorities, projects, key people, links |
| `HANDOFF.md` | 2.2KB | Active | Session continuity — current work, stopping point, next steps |
| `HEARTBEAT.md` | 0B | Empty | Should contain context monitoring instructions |
| `BOOTSTRAP.md` | 0B | Empty | Startup procedure is defined in AGENTS.md instead |
| `TOOLS.md` | 0B | Empty | No tool-specific notes currently needed |

### MEMORY.md Structure

```markdown
# MEMORY.md — Agent Briefing
<!-- MAX 1.5KB. Update data only — do not add sections. -->
<!-- Last: YYYY-MM-DD HH:MM CST -->

## This Week
## Priorities
## Projects
## Links
## Key People
```

Hard limit: 1536 bytes. Checked at every wrap by the wrap script.

### HANDOFF.md Structure

```markdown
# HANDOFF.md
<!-- Last updated: YYYY-MM-DD ~HH:MM CST -->

## Current Work
## Stopping Point
## Files Modified This Session
## Active Reviews
## Next Steps
## Open Questions
## Wayne Directives
```

Overwritten every wrap. Never appended.

---

## Skills

Skills are loaded by OpenClaw and available to the agent. Buffer-relevant skills:

| Skill | Location | Purpose |
|---|---|---|
| `session-management` | `~/.openclaw/workspace/skills/session-management/SKILL.md` | Full wrap procedure (10 steps), session reset mechanics, context monitoring thresholds |
| `cortex-observe` | `~/.openclaw/workspace/skills/cortex-observe/SKILL.md` | Observation pipeline — writes to Cortex during conversations |

The `session-management` skill is the definitive wrap procedure. When the agent wraps, it reads this skill and follows it step by step.

---

## Wrap Procedure (As Implemented)

The full 10-step procedure from the `session-management` skill:

```
Step 0:  Announce the wrap to the channel
Step 1:  Write session summary to daily log (memory/YYYY-MM-DD.md)
Step 2:  Write "Next Session Startup" section in daily log
Step 3:  Update MEMORY.md if priorities/projects changed
Step 4:  Update project files if project state changed
Step 5:  Handle active review docs (add ⚠️ Active Review marker)
Step 6:  Write HANDOFF.md (overwrite, not append)
Step 7:  Pre-flight checklist (verify all files written)
Step 8:  Run tools/session-wrap.sh "<message>" "<session-key>"
Step 9:  Schedule bootstrap ping (cron job ~15s in the future)
Step 10: gateway action=restart (last thing — no more turns after this)
```

### The Wrap Script

Located at `~/.openclaw/workspace/tools/session-wrap.sh`. Does three things:

1. **Pre-flight validation** — Verifies HANDOFF.md is non-empty, has "Next Steps", MEMORY.md is under 1.5KB. Exits non-zero if any check fails.
2. **Git commit** — `git add -A && git commit` in the workspace directory.
3. **Session deletion** — Removes the session entry from `sessions.json` using Python. This is what actually resets the session.

The script does NOT restart the gateway. That's Step 10, done by the agent via the `gateway` tool.

### The Bootstrap Ping (Step 9)

After gateway restart, the new session sits idle until it receives a message. A one-shot cron job fires ~15 seconds after the restart, sending a system event that tells the new session to:

1. Read last 20 messages from the Discord channel
2. Read HANDOFF.md
3. Announce orientation (prove it has context)

Without this, the agent starts a new session but never announces — it just waits silently.

### Session Key

The main Discord session key is:
```
agent:main:discord:channel:1470820351674945606
```

The agent finds this via `sessions_list` or uses the known key for the #workspace channel.

---

## Daily Logs

Append-only files at `~/.openclaw/workspace/memory/YYYY-MM-DD.md`. Each wrap appends a session summary. Files go back to 2026-02-09 (the start of the project).

Additional memory structure:
```
memory/
├── YYYY-MM-DD.md        # Daily session logs
├── archive/             # Older logs
├── projects/            # Per-project state files
├── reference/           # Reference material
├── templates/           # Templates
├── weekly/              # Weekly summaries
├── context-budget.md    # Context budget analysis
├── watchlist.md         # Competitor watchlist
└── working-patterns.md  # Agent working patterns
```

---

## Context Monitoring (Actual)

The agent checks context via the local API:

```bash
curl -s http://127.0.0.1:8111/api/context
```

**NOT `session_status`.** The `session_status` tool reports cumulative tokens (odometer), not current window occupancy (fuel gauge). The API endpoint reports real occupancy.

**Dashboard:** Available at `http://127.0.0.1:18789/` and via Tailscale at `https://admins-mac-mini.tail87b380.ts.net`. Shows real-time context window usage.

---

## Agents

Five agents configured, one primary:

| Agent | Role | Heartbeat | Notes |
|---|---|---|---|
| `main` (Cole) | Primary agent, all conversations | 3 min | The agent that uses Buffer |
| `builder` | Sub-agent for code tasks | disabled | Spawned by main |
| `devops` | Sub-agent for ops tasks | disabled | Spawned by main |
| `jena` | Specialized agent | disabled | |
| `worker` | General sub-agent | disabled | Spawned by main |

Only the `main` agent writes to continuity files (HANDOFF.md, MEMORY.md, daily logs). Sub-agents write to Vault/staging only.

---

## Compaction Settings

OpenClaw's auto-compaction is the emergency brake. It fires when context reaches ~100% of the operational cap (500K).

**Pre-compaction flush:** OpenClaw prompts the agent to write state before compaction. This is the last safety net.

**Post-compaction:** Agent reloads bootstrap files and reorients from HANDOFF.md. Recovery is imperfect — details from compacted context are lost.

**Known issue (fixed):** Before the beta header fix, compaction never triggered because OpenClaw thought it had 800K of headroom while Anthropic enforced 200K. Sessions crashed instead of compacting gracefully.

---

## Communication Channels

| Channel | Platform | Session Key |
|---|---|---|
| #workspace | Discord | `agent:main:discord:channel:1470820351674945606` |

The agent reads the last 20 messages from the active channel at session start to catch up on anything said while it was resetting.

---

## Known Issues and Gotchas

1. **`HEARTBEAT.md` is empty.** Context monitoring relies on rules in AGENTS.md rather than explicit heartbeat instructions. Should be written.

2. **`session_status` lies about context.** It shows cumulative tokens, not window occupancy. Always use `/api/context` or the dashboard.

3. **Gateway restart ≠ session reset.** The most common mistake. Must delete from `sessions.json` first.

4. **Bootstrap ping is required.** Without the cron job in Step 9, the new session starts but never announces. It sits idle until someone messages.

5. **MEMORY.md budget is tight.** 1.5KB is ~300 words. Every word must earn its place. The wrap script enforces this with a hard gate.

6. **Sub-agents cannot write continuity files.** Only the main session writes HANDOFF.md, MEMORY.md, and daily logs. This is by convention, not enforcement.

7. **The dashboard URL changed.** It's `http://127.0.0.1:18789/`, not `:8111`. The `/api/context` endpoint is on `:8111`.
