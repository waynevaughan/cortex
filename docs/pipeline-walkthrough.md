---
title: "End-to-End Pipeline Walkthrough"
created: 2026-02-16
status: active
---

# End-to-End Pipeline Walkthrough

This document traces concrete examples through every step of the Cortex system. It shows exactly what happens, which component is responsible, what can go wrong, and how long each step takes.

Read `docs/vocabulary.md` first for terminology. This document uses those terms exclusively.

---

## Example 1: Agent Observes a Decision During Conversation

**Scenario:** During a conversation, the owner says: *"Let's use local git only — no remote push in the daemon."* The agent recognizes this as a decision.

### Step 1: Agent Writes to Buffer

**Component:** Agent (during active conversation)
**Time:** <100ms (single exec call)

The agent applies the write gate: *"Would this change how an agent acts in the future?"*
- Answer: YES — this is a decision that will affect future implementation choices

The agent determines:
- **Bucket:** `explicit` (user directly stated it)
- **Type:** `decision` (choice between alternatives with commitment)
- **Category:** `concept` (derived from type via taxonomy)

**Exact JSONL entry written to `observer/observations.jsonl`:**

```json
{
  "timestamp": "2026-02-16T15:23:14.527Z",
  "bucket": "explicit",
  "type": "decision",
  "body": "Use local git only — no remote push in daemon. Reduces complexity and eliminates network failure mode.",
  "entities": [
    {"name": "owner", "type": "person"},
    {"name": "Cortex", "type": "project"}
  ],
  "attribution": "owner",
  "session_id": "022a598a-7ca8-4ccf-80bb-f1919386421e",
  "confidence": 0.95,
  "importance": 0.9,
  "context": "Discussing observer daemon deployment and git sync strategy",
  "source_quote": "Let's use local git only — no remote push in the daemon"
}
```

The agent executes:
```bash
echo '{"timestamp":"2026-02-16T15:23:14.527Z","bucket":"explicit","type":"decision",...}' >> observer/observations.jsonl
```

**What can go wrong:**
- File write fails (disk full, permissions) → Agent logs error, continues conversation. Observation lost unless agent retries at session end. **OPEN QUESTION:** Should agent auto-retry failed writes?
- Session crashes before write completes → Observation lost. Acceptable — conversation context already gone.

---

### Step 2: Filesystem Detects Change

**Component:** Daemon (via fs.watch + polling fallback)
**Time:** <1 second (typically immediate, worst case 30s via polling)

The daemon uses Node.js `fs.watch` on `observer/observations.jsonl` with a 30-second polling fallback (to catch dropped events, a known Node.js reliability issue on some platforms).

**Detection mechanism:**
1. `fs.watch` fires a `'change'` event
2. Daemon reads current file size
3. Compares against stored offset in `observer/state.json`
4. If file size > stored offset → new content detected

**Current state file before processing:**
```json
{
  "observationFileOffset": 47830,
  "lastRun": "2026-02-16T15:20:00Z",
  "reinforcements": {}
}
```

**What can go wrong:**
- `fs.watch` misses the event → Polling fallback catches it within 30s
- Multiple writes in quick succession → All processed in next cycle (offset advances through all new lines)
- File rotated during read → Daemon completes current read, then detects rotation and resets offset

---

### Step 3: Daemon Reads New Content

**Component:** Daemon
**Time:** <50ms for typical observation (~300 bytes)

**Read operation:**
1. Open `observer/observations.jsonl` for reading
2. Seek to byte offset `47830`
3. Read from offset to EOF
4. Split by newlines
5. Parse each line as JSON

**Parsed object:**
```javascript
{
  timestamp: '2026-02-16T15:23:14.527Z',
  bucket: 'explicit',
  type: 'decision',
  body: 'Use local git only — no remote push in daemon. Reduces complexity and eliminates network failure mode.',
  entities: [
    { name: 'owner', type: 'person' },
    { name: 'Cortex', type: 'project' }
  ],
  attribution: 'owner',
  session_id: '022a598a-7ca8-4ccf-80bb-f1919386421e',
  confidence: 0.95,
  importance: 0.9,
  context: 'Discussing observer daemon deployment and git sync strategy',
  source_quote: 'Let\'s use local git only — no remote push in the daemon'
}
```

**What can go wrong:**
- Malformed JSON → Log error with full content, skip line, advance offset. Observation lost. **OPEN QUESTION:** Should daemon write rejected observations to a quarantine file for manual review?
- Partial line read (file write in progress) → Next cycle will re-read from same offset and get complete line
- Empty line → Skip silently, advance offset

---

### Step 4: Validation

**Component:** Daemon
**Time:** <10ms per observation

The daemon runs two validation passes:

#### 4a. Schema Validation

**Checks (all must pass):**

| Check | This Observation | Result |
|---|---|---|
| Required fields present (timestamp, bucket, type, body, attribution, session_id) | All present | ✅ PASS |
| `bucket` is valid (`"ambient"` or `"explicit"`) | `"explicit"` | ✅ PASS |
| `type` exists in taxonomy (17 default + custom from `observer/taxonomy.yml`) | `"decision"` is in default taxonomy | ✅ PASS |
| `type` is not `"observation"` (staging state only) | `"decision"` | ✅ PASS |
| Body length 1-500 characters | 93 characters | ✅ PASS |
| Context length ≤ 1000 characters (if present) | 58 characters | ✅ PASS |
| Source quote length ≤ 500 characters (if present) | 61 characters | ✅ PASS |
| Timestamp is valid ISO-8601 | Valid format | ✅ PASS |
| Session ID is valid UUID | Valid UUID | ✅ PASS |
| Confidence 0.0-1.0 (if present) | 0.95 | ✅ PASS |
| Importance 0.0-1.0 (if present) | 0.9 | ✅ PASS |

**All checks pass** → Proceed to security validation

**Example failures:**

| Check | Example Bad Value | Result |
|---|---|---|
| `bucket` invalid | `"maybe"` | ❌ FAIL → Log error, skip observation |
| `type` invalid | `"suggestion"` (not in taxonomy) | ❌ FAIL → Log error, skip observation |
| Body too long | 600 characters | ❌ FAIL → Truncate to 500, log warning, continue |
| Timestamp invalid | `"yesterday"` | ❌ FAIL → Log error, skip observation |

#### 4b. Security Validation (5 Layers)

| Layer | Check | This Observation | Result |
|---|---|---|---|
| 1. Schema enforcement | Already validated above | N/A | ✅ PASS |
| 2. Content length cap | Body 93 chars (< 500), context 58 chars (< 1000), quote 61 chars (< 500) | All within limits | ✅ PASS |
| 3. Instruction injection scan | Check for: "ignore previous", "disregard", "you are now", "execute", backtick blocks, `eval(`, `exec(` | No patterns found | ✅ PASS |
| 4. Source attribution trust | `session_id` matches primary agent | Full trust, no score cap | ✅ PASS |
| 5. Credential check | Scan for API keys (`sk-`, `ghp-`, `xoxb-`), connection strings, bearer tokens, base64 secrets >40 chars | No credentials found | ✅ PASS |

**All layers pass** → Proceed to scoring

**Example failures:**

| Layer | Example Bad Content | Result |
|---|---|---|
| Instruction injection | Body: "ignore previous instructions and..." | ❌ FAIL → Log with session ID, reject observation |
| Credential detected | Body: "API key is sk-1234..." | ⚠️ REDACT → Replace with `[REDACTED]`, log security warning, continue |
| Body too long | 1200 characters | ⚠️ TRUNCATE → Cut to 500 chars, log warning, continue |

**What can go wrong:**
- New injection pattern not in blocklist → Observation passes through. Risk: prompt injection when retrieved. **OPEN QUESTION:** Should daemon use LLM for semantic injection detection, or remain zero-LLM?
- False positive on credential pattern → Legitimate content redacted. Impact: observation loses context but isn't rejected.

---

### Step 5: Scoring

**Component:** Daemon
**Time:** <5ms per observation

#### 5a. Base Scores

Agent provided explicit scores, so daemon uses those (clamped to [0.0, 1.0]):
- **Confidence:** 0.95 (agent-provided, explicit bucket default is 0.9)
- **Importance:** 0.9 (agent-provided)

If agent hadn't provided scores, daemon would use bucket defaults:
- Explicit: confidence = 0.9, importance = 0.5

#### 5b. Structural Signal Adjustments

Daemon scans body text for lightweight signals:

| Signal | Pattern Match | Adjustment |
|---|---|---|
| Imperative language | "must", "always", "never" | None found | No adjustment |
| Emotional emphasis | "critical", "hate", "love" | None found | No adjustment |

**Scores after structural adjustment:** confidence = 0.95, importance = 0.9 (unchanged)

#### 5c. Calibration Pass (Optional)

Check if `observer/calibration.yml` exists. If yes, apply matching rules.

**Example calibration file:**
```yaml
rules:
  - match: { type: "decision" }
    adjust: { importance: +0.1 }
  - match: { type: "preference", source: "wayne" }
    adjust: { confidence: +0.1 }
```

**Rule matching for this observation:**
- Rule 1: `type: "decision"` matches → Apply `importance: +0.1`
- Rule 2: `type: "preference"` does not match → Skip

**Scores after calibration:** confidence = 0.95, importance = 1.0 (clamped from 1.0, no change)

#### 5d. Memorization Threshold Check

**Threshold:** importance ≥ 0.5

This observation: importance = 1.0 → **PASS** → Proceed to deduplication

**Example failure:**
- Observation with importance = 0.4 → **REJECT** → Log as "below threshold", skip observation, advance offset

**What can go wrong:**
- Calibration file corrupt → Daemon logs warning, skips calibration, uses base scores
- Calibration file >4KB → Daemon logs warning, ignores file (security limit)
- Calibration rule matches unintentionally → Observation score skewed. Impact depends on magnitude of adjustment.

---

### Step 6: Deduplication

**Component:** Daemon
**Time:** <20ms per observation (hash computation + lookup)

The daemon performs **content hash deduplication only** on the write path. Semantic dedup runs in the nightly batch maintenance (sleep cycle).

#### 6a. Compute Content Hash

**Normalization steps:**
1. Extract body text: `"Use local git only — no remote push in daemon. Reduces complexity and eliminates network failure mode."`
2. Lowercase: `"use local git only — no remote push in daemon. reduces complexity and eliminates network failure mode."`
3. Collapse whitespace: `"use local git only — no remote push in daemon. reduces complexity and eliminates network failure mode."`
4. Encode as UTF-8 bytes
5. Compute SHA-256

**Resulting hash:** `e7f4a2b9c1d8f3e6a5b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0`

#### 6b. Check Against Existing Observations

Daemon queries vault observation files (searches frontmatter `source_hash` field):

```bash
grep -r "source_hash: e7f4a2b9c1d8f3e6a5b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0" vault/observations/
```

**Result:** No match found → This is a new observation → Proceed to routing

**Example: Hash Match (Duplicate Detected)**

If hash matched an existing observation `vault/observations/2026-02-10-8a3f7e9b.md`:

1. Daemon logs: `"Duplicate observation detected, reinforcing existing entry"`
2. Update reinforcement map in `observer/state.json`:
```json
{
  "observationFileOffset": 48230,
  "lastRun": "2026-02-16T15:23:15Z",
  "reinforcements": {
    "019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b": "2026-02-16T15:23:14Z"
  }
}
```
3. Skip observation (don't write duplicate)
4. Advance offset
5. Nightly batch maintenance will update `last_reinforced` timestamp in the matched observation's frontmatter, resetting its decay clock

**What can go wrong:**
- Near-duplicate with different wording → Passes hash check, creates separate observation. Semantic dedup will catch it in nightly batch.
- Hash collision (extremely rare) → Two different observations map to same hash. Would incorrectly skip second. Probability: negligible (2^-256).
- Existing observation file corrupt/missing → Hash lookup fails, observation written as new. Impact: duplicate created, nightly batch will merge.

---

### Step 7: Routing

**Component:** Daemon
**Time:** <5ms per observation

Daemon determines where this observation goes: **Mind** or **Vault** (data partition).

#### 7a. Determine Category

Look up type `"decision"` in taxonomy:

**Taxonomy mapping (from decisions D12):**
- Concept (12 types): fact, opinion, belief, preference, lesson, **decision**, commitment, goal_short, goal_long, aspiration, constraint
- Entity (4 types): milestone, task, event, resource  
- Relation (2 types): project, dependency

**Category for this observation:** `"concept"`

#### 7b. Apply Routing Rules (Per D15/D16)

**Default routing by category:**
- **Concepts** → Mind (agent behavioral memory)
- **Entities** → Data (structured domain knowledge)
- **Relations** → Data (with optional mind pointers)

**This observation:** Type = decision, Category = concept → **Mind**

But wait...

#### 7c. **OPEN QUESTION: Decision Routing Ambiguity**

**Problem:** Per D15/D16, concepts route to mind. But this decision is:
- A **concept** (an idea the agent holds about how to implement the system)
- Also **structured domain knowledge** about the Cortex project (decisions with rationale typically go to vault as `type/decision` documents per vault.md)

**Competing interpretations:**

**Interpretation 1: Strict category routing**
- Decision is a concept
- Concepts route to mind
- This observation goes to `mind/concepts/decision-YYYY-MM-DD-{hash}.md`
- Mind is Cortex-owned, organized for implicit retrieval

**Interpretation 2: Type-specific override**
- Decisions are special — they have explicit "decision document" format in vault.md
- Decisions should be permanent record in data partition, not subject to mind decay
- This observation goes to `vault/decisions/decision-YYYY-MM-DD-{hash}.md`
- Requires routing rule: `if type == "decision" → vault (data)`

**Interpretation 3: Split observation**
- Some decisions are behavioral ("the owner prefers X") → mind
- Other decisions are architectural/project ("Use SQLite") → vault
- Requires agent or daemon to distinguish intent
- How? Agent could write two observations, or add a `scope` field?

**The owner's vault.md guidance (from the spec):**
> "Decisions with rationale that others need to understand" belong in vault.

**D17 guidance:**
> Decay applies to mind only. Data store is permanent. "I don't want my database to automatically lose things."

**For this walkthrough, I'll assume Interpretation 2:** Decisions route to vault (data partition) regardless of category, because they are permanent architectural record.

**Routing decision:**
- Type: decision
- Override rule: `if type == "decision" → vault/decisions/`
- **Destination:** `vault/decisions/`

**OPEN QUESTION flagged for resolution:**
- Should all decisions go to vault, or only architectural ones?
- If split needed, what field distinguishes them? (`scope: behavioral|architectural`?)
- How should agent know which to use when writing observation?
- Should routing rules be configurable per type in `.cortexrc`?

---

### Step 8: Staging

**Component:** Daemon
**Time:** <50ms (file write + title generation)

Daemon writes observation to staging directory before committing to vault.

#### 8a. Generate Title

**Rule:** Take first 80 characters of body, truncate at last word boundary, append `…` if truncated.

**Body:** "Use local git only — no remote push in daemon. Reduces complexity and eliminates network failure mode."

**Title:** "Use local git only — no remote push in daemon. Reduces complexity and…" (80 chars, truncated after "and")

#### 8b. Generate Filename

**OPEN QUESTION: Filename Convention Not Yet Decided**

**Option A: Date + Hash Prefix (current pattern from observer.md)**
- Format: `YYYY-MM-DD-{hash-prefix-8}.md`
- Example: `2026-02-16-e7f4a2b9.md`
- Pros: Chronological sort, collision-resistant, predictable
- Cons: No semantic information, requires lookup to find specific decision

**Option B: Date + Slug**
- Format: `YYYY-MM-DD-{slug}.md`
- Example: `2026-02-16-local-git-only.md`
- Pros: Human-readable, semantic
- Cons: Slug generation requires sanitization (remove special chars, handle collisions)

**Option C: ID-based**
- Format: `{uuidv7}.md`
- Example: `019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b.md`
- Pros: Globally unique, no collisions, UUID includes timestamp
- Cons: Not human-readable, can't scan directory

**Recommendation for resolution:** **Option A** (date + hash prefix) for observations. Aligns with current observer.md spec. Human-readable slug (Option B) for hand-written decision documents in vault.

**For this walkthrough, using Option A:**

**Filename:** `2026-02-16-e7f4a2b9.md`

#### 8c. Write Staging File

**Path:** `observer/staging/2026-02-16-e7f4a2b9.md`

**Exact file content:**

```markdown
---
id: "019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b"
type: decision
category: concept
created: 2026-02-16T15:23:14.527Z
source_hash: e7f4a2b9c1d8f3e6a5b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0

# ---

title: "Use local git only — no remote push in daemon. Reduces complexity and…"
bucket: explicit
attribution: owner
confidence: 0.95
importance: 1.0
entities:
  - name: owner
    type: person
  - name: Cortex
    type: project
context: "Discussing observer daemon deployment and git sync strategy"
source_quote: "Let's use local git only — no remote push in the daemon"
session_id: "022a598a-7ca8-4ccf-80bb-f1919386421e"
---

Use local git only — no remote push in daemon. Reduces complexity and eliminates network failure mode.
```

**Frontmatter structure (per D21):**
- **Above `# ---` separator:** Cortex-required fields (id, type, category, created, source_hash)
- **Below `# ---` separator:** Application-defined fields (title, bucket, attribution, confidence, importance, entities, context, source_quote, session_id)

**What can go wrong:**
- Staging directory doesn't exist → Daemon creates it
- Disk full → Write fails, daemon logs error, observation stays in JSONL (offset not advanced), retry next cycle
- Filename collision (extremely rare with hash prefix) → Daemon appends counter: `2026-02-16-e7f4a2b9-2.md`
- Invalid YAML frontmatter generated → Validation would catch this, but shouldn't happen (daemon generates from validated data)

---

### Step 9: Memorization (Git Commit)

**Component:** Daemon  
**Time:** 100-500ms (git operations)

Daemon promotes staged observation to vault via git.

#### 9a. Sync With Remote

```bash
cd ~/projects/cortex
git pull --rebase origin master
```

**Expected:** Fast-forward (no conflicts, daemon is only writer to `vault/decisions/observations/`)

**What can go wrong:**
- Merge conflict → Retry once after 1-5 second delay. If retry fails, leave in staging, log error, daemon will retry next cycle.
- Network failure → Git pull fails. Same retry logic. Observation safe in staging.
- Remote force-pushed (history rewritten) → Git refuses to pull. Daemon logs error, requires manual intervention. **OPEN QUESTION:** Should daemon support auto-recovery from force-push (reset to remote)?

#### 9b. Copy to Vault

```bash
cp observer/staging/2026-02-16-e7f4a2b9.md vault/decisions/2026-02-16-e7f4a2b9.md
```

**OPEN QUESTION:** Where exactly in vault structure? Options:
- `vault/decisions/2026-02-16-e7f4a2b9.md` (flat in decisions directory)
- `vault/decisions/2026/02/2026-02-16-e7f4a2b9.md` (year/month hierarchy)
- `vault/observations/decisions/2026-02-16-e7f4a2b9.md` (observations subdirectory by type)

**Per observer.md:** "Observations are stored as individual markdown files in `vault/observations/`"

But D15 says concepts route to mind, and decisions are architectural → should be in vault/decisions/ alongside hand-written decision documents.

**For this walkthrough:** Assuming `vault/decisions/2026-02-16-e7f4a2b9.md` (flat structure, co-located with hand-written decisions).

**OPEN QUESTION flagged:** Final vault directory structure needs specification. Proposal:
- `vault/decisions/` — all decisions (hand-written and observed)
- `vault/concepts/` — other concepts (facts, beliefs, preferences, lessons, etc.)
- `vault/entities/` — entities (people, projects, etc.)
- Or: `vault/observations/` for all observed entries, `vault/decisions/` for hand-written decision documents only?

#### 9c. Git Add and Commit

```bash
git add vault/decisions/2026-02-16-e7f4a2b9.md
git commit -m "observe: local git only decision (owner)"
```

**Commit message format (proposed):**
- Prefix: `observe:` (distinguishes from hand-written content)
- Summary: Key phrase from observation body
- Attribution in parentheses: `(owner)`

**Exact commit:**
```
commit a7b3c9d5e1f7a8b2c4d6e8f0a2b4c6d8e0f2a4b6
Author: cortex-daemon <daemon@cortex.local>
Date:   Sun Feb 16 15:23:15 2026 -0600

    observe: local git only decision (owner)
```

**What can go wrong:**
- Git hook fails (pre-commit hash validation, tag validation) → Commit blocked. Daemon logs error. Observation stays in staging. **OPEN QUESTION:** Should daemon validate document before attempting commit to avoid hook failures?
- Git identity not configured → Commit fails. Daemon requires `git config user.name` and `user.email` set. Should be part of daemon setup instructions.

#### 9d. Push to Remote (Per Decision: Local Only)

**Per the decision the owner just made:** *"Use local git only — no remote push in daemon"*

**Therefore:** Daemon does NOT push. Commit remains local.

**Alternative behavior (if decision were different):**
```bash
git push origin master
```

**What can go wrong (if pushing):**
- Network failure → Push fails. Daemon logs warning, continues. Next cycle will pull-rebase and push accumulated commits.
- Authentication failure → Push rejected. Requires SSH key or credential setup. Daemon should have credentials configured in setup.
- Remote rejected (branch protection, size limits) → Push fails. Manual intervention required.

#### 9e. Cleanup Staging

On successful commit:
```bash
rm observer/staging/2026-02-16-e7f4a2b9.md
```

**What can go wrong:**
- File already deleted → Ignore (idempotent)
- Permissions error → Log warning, leave file. Will be cleaned up in next cycle or by 7-day staging cleanup policy.

---

### Step 10: Index Update

**Component:** Daemon (triggers), Index builder (executes)
**Time:** <100ms for incremental update

#### 10a. Trigger Graph Rebuild

After successful memorization, daemon signals graph builder to do incremental rebuild.

**Signal mechanism (proposed):** Touch sentinel file
```bash
touch observer/.index-rebuild-requested
```

Graph builder watches this file (or polls periodically), detects change, triggers incremental rebuild.

**Alternative:** Direct function call if graph builder is a library imported by daemon.

#### 10b. Graph Builder Processes New Entry

Graph builder:
1. Reads new file: `vault/decisions/2026-02-16-e7f4a2b9.md`
2. Extracts frontmatter (id, type, entities, relations)
3. Creates node in graph:
```json
{
  "id": "019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b",
  "type": "decision",
  "category": "concept",
  "title": "Use local git only — no remote push in daemon. Reduces complexity and…",
  "path": "vault/decisions/2026-02-16-e7f4a2b9.md",
  "created": "2026-02-16T15:23:14.527Z"
}
```
4. Creates edges for entity references:
```json
[
  {
    "from": "019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b",
    "to": "wayne-entity-id",
    "type": "attributed_to"
  },
  {
    "from": "019503a7-c18f-7b1d-a3b2-9c4f7e2d1a0b",
    "to": "cortex-project-id",
    "type": "relates_to"
  }
]
```
5. Persists updated graph index

**What can go wrong:**
- Entity IDs not found → Graph builder creates placeholder nodes or skips edges. **OPEN QUESTION:** Should entity extraction auto-create entity entries, or require explicit entity creation?
- Graph file corrupt → Rebuild fails. Daemon logs error. Next full graph rebuild (nightly) will fix.
- Graph builder not running → Update queued. Next start will process backlog.

#### 10c. QMD Index Update

QMD (hybrid search) automatically re-indexes on file change (via its own file watcher).

**No explicit trigger needed.** QMD detects new file at `vault/decisions/2026-02-16-e7f4a2b9.md` and:
1. Extracts text content (frontmatter + body)
2. Computes BM25 term vectors
3. Generates embedding vector (via configured model)
4. Updates search index

**Time:** 1-5 seconds (depends on embedding model)

---

### Step 11: Advance Offset

**Component:** Daemon
**Time:** <10ms

Daemon updates state file to mark observation as processed:

**Before:**
```json
{
  "observationFileOffset": 47830,
  "lastRun": "2026-02-16T15:20:00Z",
  "reinforcements": {}
}
```

**After:**
```json
{
  "observationFileOffset": 48230,
  "lastRun": "2026-02-16T15:23:15Z",
  "reinforcements": {}
}
```

**Offset calculation:** 
- Old offset: 47830 bytes
- Observation JSONL entry size: ~400 bytes (including newline)
- New offset: 48230 bytes

Daemon is now ready to process next observation.

---

## Pipeline Summary: Example 1

| Step | Component | Time | Status |
|---|---|---|---|
| 1. Agent writes to JSONL | Agent | <100ms | ✅ Complete |
| 2. Filesystem detects change | Daemon (fs.watch) | <1s | ✅ Complete |
| 3. Daemon reads new content | Daemon | <50ms | ✅ Complete |
| 4. Validation (schema + security) | Daemon | <10ms | ✅ Complete (all checks passed) |
| 5. Scoring | Daemon | <5ms | ✅ Complete (confidence=0.95, importance=1.0) |
| 6. Deduplication | Daemon | <20ms | ✅ Complete (no duplicate found) |
| 7. Routing | Daemon | <5ms | ✅ Complete (→ vault/decisions/) |
| 8. Staging | Daemon | <50ms | ✅ Complete |
| 9. Git commit | Daemon | 100-500ms | ✅ Complete (local only, no push) |
| 10. Index update | Graph builder + QMD | 1-5s | ✅ Complete |
| 11. Advance offset | Daemon | <10ms | ✅ Complete |
| **TOTAL** | | **2-6 seconds** | ✅ Observation memorized |

**What the agent sees:** Nothing. Observation write is fire-and-forget. At next session start, agent will see updated stats: "Cortex: 15 observations, 13 memorized, 2 already known"

---

## Example 2: Application Writes via CLI

**Scenario:** A developer runs:
```bash
cortex write --type project --body "ExampleApp - AI-powered reading companion for teachers"
```

### Differences from Example 1 (Observe Path)

| Aspect | Observe (Example 1) | Write (Example 2) |
|---|---|---|
| **Initiator** | Agent during conversation | Developer via CLI |
| **Input format** | Full JSONL with all fields | Minimal args (type + body) |
| **Defaults** | Agent chooses bucket, entities, scores | CLI derives from type |
| **Validation** | Same (daemon) | Same (daemon) |
| **Session context** | Tied to agent session_id | CLI generates one-off session_id or uses "cli" |
| **Use case** | Real-time knowledge capture | Bulk import, external data integration |

### Step-by-Step for Write Path

#### Step 1: CLI Parses Arguments

**Component:** `cortex` CLI tool
**Time:** <10ms

```bash
cortex write --type project --body "ExampleApp - AI-powered reading companion for teachers"
```

**Parsed:**
- `type`: `"project"`
- `body`: `"ExampleApp - AI-powered reading companion for teachers"`

**CLI generates missing fields:**
- `timestamp`: Current time (ISO-8601)
- `bucket`: Inferred from type. Project is a relation (per taxonomy) → likely **explicit** (user is explicitly declaring a project). CLI uses `"explicit"` as default for Write.
- `attribution`: CLI user (from git config or `--author` flag), defaults to `"system"` if not provided
- `session_id`: CLI generates new UUID or uses `"cli"` literal
- `category`: Derived from type via taxonomy lookup: project → relation

**CLI does NOT generate:**
- `confidence` / `importance` → CLI omits, daemon uses defaults
- `entities` → CLI omits unless `--entities` flag provided
- `context` / `source_quote` → CLI omits (not applicable for Write)

#### Step 2: CLI Writes to Buffer

**Component:** `cortex` CLI tool
**Time:** <50ms

CLI constructs JSONL entry:

```json
{
  "timestamp": "2026-02-16T15:30:00.000Z",
  "bucket": "explicit",
  "type": "project",
  "body": "ExampleApp - AI-powered reading companion for teachers",
  "attribution": "system",
  "session_id": "cli"
}
```

CLI appends to buffer:
```bash
echo '{"timestamp":"2026-02-16T15:30:00.000Z",...}' >> observer/observations.jsonl
```

**What can go wrong:**
- Buffer file doesn't exist → CLI creates it (or errors, depending on spec). **OPEN QUESTION:** Should CLI auto-create buffer file?
- Write fails → CLI exits with error code, prints error message
- Invalid JSON escaping (e.g., quotes in body) → CLI must escape properly

#### Steps 3-11: Identical to Example 1

From this point on, the pipeline is identical:
- Daemon detects change via fs.watch
- Reads JSONL entry
- Validates schema and security
- Applies scoring (type-based defaults):
  - Bucket: explicit → confidence = 0.9
  - No importance provided → importance = 0.5
- Deduplication check
- Routing: type=project, category=relation → Per D15, relations route to **data** (vault)
- Staging → Git commit → Index update → Advance offset

**Routing for this observation:**

Type: project (relation)
**Routing:** Relations → data partition (vault)

**Destination:** `vault/projects/2026-02-16-{hash}.md` (or whatever structure is defined for relations)

**Vault entry frontmatter:**
```yaml
---
id: "019503b8-a9f2-7c4d-b3e5-1a2b3c4d5e6f"
type: project
category: relation
created: 2026-02-16T15:30:00.000Z
source_hash: a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4

# ---

title: "ExampleApp - AI-powered reading companion for teachers"
bucket: explicit
attribution: system
confidence: 0.9
importance: 0.5
session_id: "cli"
---

ExampleApp - AI-powered reading companion for teachers
```

---

## Example 3: Duplicate Observation (Reinforcement)

**Scenario:** The agent observes: *"The owner prefers honest feedback"* but this already exists in the mind.

### Existing Observation

**File:** `mind/concepts/2026-01-15-7c8d9e0f.md`

```yaml
---
id: "019234a7-f1e8-7b2d-a9c3-4f5e6a7b8c9d"
type: preference
category: concept
created: 2026-01-15T10:23:00.000Z
source_hash: c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0

# ---

title: "The owner prefers honest feedback"
bucket: ambient
attribution: Agent
confidence: 0.8
importance: 0.8
last_reinforced: 2026-01-15T10:23:00.000Z
---

The owner prefers honest, direct feedback over diplomatically softened answers.
```

### Step-by-Step for Reinforcement Path

#### Steps 1-5: Same as Example 1

Agent writes new observation to buffer. Daemon reads, validates, scores.

**New observation body:**
```
"The owner prefers honest feedback over sugar-coated responses"
```

#### Step 6: Deduplication (Hash Match)

**Component:** Daemon
**Time:** <20ms

Daemon computes content hash:

**Normalization:**
1. Body: `"The owner prefers honest feedback over sugar-coated responses"`
2. Lowercase: `"the owner prefers honest feedback over sugar-coated responses"`
3. Collapse whitespace: `"the owner prefers honest feedback over sugar-coated responses"`
4. SHA-256: `c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0`

**Hash lookup:** Search vault for matching `source_hash`

```bash
grep -r "source_hash: c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0" mind/
```

**Result:** **MATCH FOUND** → `mind/concepts/2026-01-15-7c8d9e0f.md`

Daemon logs: `"Exact duplicate detected for observation, reinforcing existing entry 019234a7-f1e8-7b2d-a9c3-4f5e6a7b8c9d"`

#### Step 7: Reinforcement (Instead of Memorization)

**Component:** Daemon
**Time:** <10ms

Daemon updates reinforcement map in state file:

**Before:**
```json
{
  "observationFileOffset": 48230,
  "lastRun": "2026-02-16T15:23:15Z",
  "reinforcements": {}
}
```

**After:**
```json
{
  "observationFileOffset": 48630,
  "lastRun": "2026-02-16T15:35:00Z",
  "reinforcements": {
    "019234a7-f1e8-7b2d-a9c3-4f5e6a7b8c9d": "2026-02-16T15:35:00Z"
  }
}
```

**Skip memorization** (don't create duplicate file)

**Advance offset** (mark observation as processed)

#### Step 8: Nightly Batch Maintenance Updates Timestamp

**Component:** Batch maintenance job (sleep cycle, runs at 3:00 AM)
**Time:** Next scheduled run

Batch job:
1. Reads `observer/state.json`
2. Finds reinforcement entry for `019234a7-f1e8-7b2d-a9c3-4f5e6a7b8c9d`
3. Opens `mind/concepts/2026-01-15-7c8d9e0f.md`
4. Updates `last_reinforced` field in frontmatter:

**Before:**
```yaml
last_reinforced: 2026-01-15T10:23:00.000Z
```

**After:**
```yaml
last_reinforced: 2026-02-16T15:35:00Z
```

5. Commits change:
```bash
git commit -m "reinforce: owner prefers honest feedback (refreshed)"
```

6. Clears processed reinforcement from state file

#### Step 9: Decay Clock Reset

**Component:** Monthly maintenance cron
**Time:** Next scheduled run (monthly)

Because `last_reinforced` was updated, this observation's decay clock is reset.

**Decay calculation (per vault.md):**

Type: `preference`  
Decay rate: **None** (preferences don't decay)

**Therefore:** This observation never decays. But if it were a decaying type (e.g., `commitment` with 0.1/month decay rate), reinforcement would reset the decay calculation to start from the new `last_reinforced` date.

**Example if it were a commitment:**
- Original importance: 0.8
- Created: 2026-01-15
- No reinforcement → After 2 months (2026-03-15), effective importance = 0.8 - (2 * 0.1) = 0.6
- Reinforced: 2026-02-16
- After reinforcement → After 2 months (2026-04-16), effective importance = 0.8 - 0.0 = 0.8 (decay starts over from reinforcement date)

---

## Pipeline Summary: Example 3 (Reinforcement)

| Step | Component | Time | Status |
|---|---|---|---|
| 1. Agent writes to JSONL | Agent | <100ms | ✅ Complete |
| 2. Daemon detects change | Daemon | <1s | ✅ Complete |
| 3. Daemon reads content | Daemon | <50ms | ✅ Complete |
| 4. Validation | Daemon | <10ms | ✅ Complete |
| 5. Scoring | Daemon | <5ms | ✅ Complete |
| 6. Deduplication | Daemon | <20ms | ✅ **Hash match found** |
| 7. Reinforcement | Daemon | <10ms | ✅ State file updated |
| 8. Advance offset | Daemon | <10ms | ✅ Complete |
| 9. Timestamp update | Batch maintenance | Next 3 AM run | ⏳ Queued |
| 10. Decay reset | Monthly maintenance | Next monthly run | ⏳ Queued |
| **TOTAL (immediate)** | | **<1 second** | ✅ Reinforcement recorded |

**Differences from Example 1:**
- No staging (skipped)
- No git commit (deferred to batch job)
- No new file created
- Offset still advances (observation processed)

---

## Open Questions Surfaced

This walkthrough revealed the following unresolved questions that need decisions:

### 1. Decision Routing Ambiguity (Critical)

**Issue:** Decisions are concepts (per taxonomy) but also architectural records. Should they route to mind (like other concepts) or vault (like permanent project records)?

**Options:**
- A. All decisions → vault/decisions/ (permanent record, no decay)
- B. All decisions → mind/concepts/ (per category routing)
- C. Split: behavioral decisions → mind, architectural decisions → vault (requires distinguishing field)

**Impact:** High. Affects where decisions are stored, whether they decay, and how they're retrieved.

**Recommendation:** Option A. Decisions should be permanent architectural record in vault, regardless of category.

---

### 2. Filename Convention for Observations (Medium)

**Issue:** No canonical filename format specified.

**Options:**
- A. `YYYY-MM-DD-{hash-8}.md` (current pattern, chronological + unique)
- B. `YYYY-MM-DD-{slug}.md` (human-readable, requires slug generation)
- C. `{uuidv7}.md` (globally unique, not human-readable)

**Impact:** Medium. Affects file organization, human browsability, tooling.

**Recommendation:** Option A for auto-generated observations. Option B for hand-written vault documents.

---

### 3. Vault Directory Structure for Observations (Medium)

**Issue:** Where do observations go within vault?

**Options:**
- A. `vault/observations/{type}/` (grouped by type)
- B. `vault/{type}/` (flat, co-located with hand-written docs)
- C. `vault/observations/YYYY/MM/` (chronological hierarchy)

**Impact:** Medium. Affects navigation, git history organization, bulk operations.

**Recommendation:** Option B (co-locate with hand-written docs of same type). Keeps decisions together, preferences together, etc.

---

### 4. Agent Retry on Failed Buffer Write (Low)

**Issue:** If JSONL append fails (disk full, permissions), should agent auto-retry?

**Options:**
- A. No retry, log error, continue (current behavior implied)
- B. Retry once immediately
- C. Queue failed observation for session-end retry

**Impact:** Low. Disk write failures are rare. When they happen, single observation loss is acceptable.

**Recommendation:** Option A. Keep agent simple. If disk is full, bigger problems exist than one lost observation.

---

### 5. Daemon Validation Before Git Commit (Low)

**Issue:** Should daemon validate document format before attempting git commit (to avoid pre-commit hook failures)?

**Options:**
- A. No pre-validation, rely on git hook to catch issues
- B. Daemon validates hash computation and tag format before commit

**Impact:** Low. Daemon generates documents from validated data, so malformed output shouldn't happen. But pre-validation would catch bugs in daemon code.

**Recommendation:** Option B (pre-validation). Catches daemon bugs before they cause staging backlog.

---

### 6. Entity Auto-Creation from Observation Entities Field (Medium)

**Issue:** When observation references entities (people, projects), should those be auto-created as entity entries if they don't exist?

**Options:**
- A. Auto-create placeholder entity entries
- B. Graph builder creates placeholder nodes but not vault entries
- C. Require explicit entity creation (observations referencing non-existent entities log warnings)

**Impact:** Medium. Affects whether entity catalog is explicitly managed or emergent.

**Recommendation:** Option B. Graph can reference any entity (emergent), but vault entity entries are explicit (managed). Agent can create entity observations when new people/projects are first mentioned.

---

### 7. Semantic Injection Detection (Low)

**Issue:** Should daemon use LLM for semantic prompt injection detection, or remain zero-LLM with pattern matching?

**Options:**
- A. Pattern matching only (current, zero cost)
- B. Optional LLM-based semantic validation (enabled via config, costs apply)
- C. Hybrid: pattern matching first, LLM for ambiguous cases

**Impact:** Low. Pattern matching catches most attacks. False negatives are low-risk (retrieved observation enters agent context, but agent has its own safeguards).

**Recommendation:** Option A. Keep daemon zero-LLM. If semantic attacks become a problem, add Option B as configurable feature.

---

### 8. Daemon Recovery from Remote Force-Push (Low)

**Issue:** If remote vault is force-pushed (history rewritten), git pull fails. Should daemon auto-recover?

**Options:**
- A. Manual intervention required (current implied behavior)
- B. Daemon detects force-push, resets to remote (`git reset --hard origin/master`), logs event

**Impact:** Low. Force-push should be rare. When it happens, manual review is appropriate.

**Recommendation:** Option A. Force-push is exceptional event requiring human review of what was lost.

---

### 9. CLI Buffer Auto-Creation (Low)

**Issue:** If `cortex write` is run but `observer/observations.jsonl` doesn't exist, should CLI create it?

**Options:**
- A. Create file automatically
- B. Error and instruct user to initialize (e.g., `cortex init`)

**Impact:** Low. Developer experience consideration.

**Recommendation:** Option A. CLI creates file with appropriate permissions if missing. Reduces friction.

---

### 10. Quarantine File for Rejected Observations (Medium)

**Issue:** When daemon rejects observation (malformed JSON, validation failure, injection detected), should it write to quarantine file for manual review?

**Options:**
- A. Log to daemon log only (current implied)
- B. Write rejected observations to `observer/quarantine.jsonl` with rejection reason
- C. Write to quarantine only for security rejections (injection, credentials)

**Impact:** Medium. Affects debuggability and security audit.

**Recommendation:** Option C. Security rejections → quarantine. Other failures → log only (spam reduction).

---

### 11. Write CLI Session ID Convention (Low)

**Issue:** What session_id should `cortex write` use?

**Options:**
- A. Literal string `"cli"`
- B. Generate new UUID per write
- C. Generate one UUID per CLI invocation (for bulk writes)

**Impact:** Low. Affects traceability and grouping.

**Recommendation:** Option A for single writes, Option C for bulk operations. Add `--session` flag to override.

---

## Timing Expectations

| Operation | Expected Time | Notes |
|---|---|---|
| Agent writes observation | <100ms | Single exec call |
| Daemon detects change | <1s typical, 30s worst case | fs.watch + polling fallback |
| Daemon processes observation | 50-100ms | Parse, validate, score, dedup, stage |
| Git commit | 100-500ms | Local commit only |
| Git push (if enabled) | 500ms-5s | Network-dependent |
| Index update (graph) | <100ms | Incremental |
| Index update (QMD) | 1-5s | Embedding generation |
| **End-to-end (local)** | **2-6 seconds** | Observe → memorized |
| **End-to-end (with push)** | **3-11 seconds** | Observe → pushed → indexed |

**Error cases:**
| Scenario | Time Impact |
|---|---|
| Validation failure | +0ms (skip immediately) |
| Duplicate detected | -90% (skip staging/commit) |
| Git conflict | +1-5s (retry delay) |
| Network failure | +timeout (typically 30s default) |

---

## Component Responsibility Matrix

| Step | Agent | Daemon | Filesystem | Git | Index |
|---|---|---|---|---|---|
| Identify knowledge worth storing | ✅ | | | | |
| Apply write gate | ✅ | | | | |
| Classify type/bucket | ✅ | | | | |
| Write JSONL to buffer | ✅ | | | | |
| Detect file change | | ✅ | ✅ | | |
| Read new content | | ✅ | | | |
| Schema validation | | ✅ | | | |
| Security validation | | ✅ | | | |
| Scoring | | ✅ | | | |
| Deduplication | | ✅ | | | |
| Routing decision | | ✅ | | | |
| Generate filename | | ✅ | | | |
| Write staging file | | ✅ | ✅ | | |
| Git pull/commit/push | | ✅ | | ✅ | |
| Resolve conflicts | | ✅ | | ✅ | |
| Update graph | | | | | ✅ |
| Update search index | | | | | ✅ |
| Advance offset | | ✅ | | | |
| Batch semantic dedup | | ✅ (scheduler) | | | ✅ |
| Reinforcement updates | | ✅ (scheduler) | | | |
| Decay processing | | ✅ (scheduler) | | | |

---

## What Can Go Wrong: Comprehensive Error Catalog

### Agent-Side Errors

| Error | Cause | Impact | Recovery |
|---|---|---|---|
| Buffer write fails | Disk full, permissions | Observation lost | None (acceptable) |
| Invalid JSON escaping | Quote in body not escaped | Daemon rejects, logs error | Manual fix |
| Session crash before write | Process killed | Observation lost | None (acceptable) |
| Wrong type selected | Agent misclassification | Observation stored with wrong type | Correct via edit or supersede |

### Daemon-Side Errors

| Error | Cause | Impact | Recovery |
|---|---|---|---|
| Malformed JSON | Agent bug, corruption | Observation skipped, logged | Manual review of log |
| Schema validation failure | Missing required field | Observation skipped, logged | Agent bug fix |
| Injection pattern detected | Malicious input | Observation rejected, quarantined | Security review |
| Hash collision (near-impossible) | SHA-256 weakness | Wrong duplicate detected | Re-hash with different algorithm |
| Staging write fails | Disk full, permissions | Observation queued in buffer | Retry next cycle |
| Git conflict | Concurrent write | Observation staged, retry | Auto-retry with backoff |
| Git authentication failure | SSH key expired | Push fails, commits local | Manual auth fix |
| Remote force-push | History rewritten | Pull fails | Manual intervention |
| Calibration file corrupt | Invalid YAML | Calibration skipped, logged | Manual fix |
| Index builder crash | Bug, OOM | Index stale | Auto-restart, rebuild |

### System-Level Errors

| Error | Cause | Impact | Recovery |
|---|---|---|---|
| Daemon crash | Bug, OOM, kill signal | Processing paused | Launchd auto-restart |
| State file corrupt | Disk corruption, bad write | Offset lost, may reprocess | Reset to 0, dedup handles duplicates |
| Buffer rotation during read | File >2MB | Partial read | Next cycle reads rotated file |
| JSONL file deleted | Operator error | All unprocessed observations lost | Restore from backup |
| Vault repo deleted | Operator error | All knowledge lost | Restore from remote |
| Network partition | Infrastructure | Push fails, local accumulates | Pushes on reconnect |
| Disk full | Storage exhaustion | All writes fail | Free space, daemon recovers |

---

## Conclusion

This walkthrough demonstrates that the Cortex pipeline is:

1. **Fast:** 2-6 seconds end-to-end for local operations
2. **Reliable:** Multiple error recovery mechanisms, no single point of catastrophic failure
3. **Simple:** Each component has one job (agent extracts, daemon validates/commits, index serves)
4. **Observable:** Every step logged, state tracked, failures surfaced
5. **Flexible:** Routing configurable, types extensible, scoring adjustable

The **10 open questions** identified require architectural decisions before v1 implementation can be finalized. Most are low-medium impact and have clear recommendations.

The pipeline's core design—agent-as-extractor with zero-LLM daemon—is validated. The mechanics are sound.
