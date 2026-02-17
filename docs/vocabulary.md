---
title: "Cortex Vocabulary"
created: 2026-02-16
status: active
---

# Cortex Vocabulary

Canonical terms for the Cortex system. Use these consistently across all specs, docs, and code.

---

## System

| Term | Definition |
|---|---|
| **Cortex** | The memory infrastructure. Has two partitions: Mind and Vault. Runs the daemon and index. A git repository. |
| **Mind** | Agent behavioral memory. Cortex-owned. Compact entries that shape how the agent operates. Subject to decay. |
| **Vault** | Structured domain knowledge. Application-owned. Permanent record. Organized by the application via config. |
| **Index** | Derived, rebuildable search and graph layer over the Cortex. Not authoritative — Mind and Vault are the source of truth. |
| **Explorer** | Bundled dev tool. Visualize, search, and browse a Cortex installation. Domain-agnostic. |

## Entities

| Term | Definition |
|---|---|
| **Observation** | Ephemeral input from an agent during conversation. Written to the queue by the agent during conversation. The agent decides what to observe — there is no automated extraction. A staging state, not a type. Consumed by the daemon and transformed into an entry. |
| **Entry** | A document in the Cortex (mind or vault). Has Cortex frontmatter + body. Created exclusively through the daemon pipeline. |
| **Type** | The specific kind of knowledge (fact, decision, preference, person, project, etc.). 21 defaults, extensible via taxonomy config. |
| **Category** | The grouping above type. Three categories: concept (ideas), entity (things), relation (connections). Every type belongs to one category. |
| **Taxonomy** | The full type→category mapping. Ships with defaults, extensible via `taxonomy.yml`. Add-only. |

## Infrastructure

| Term | Definition |
|---|---|
| **Queue** | The JSONL file. Append-only processing queue. The single entry point for all writes to the Cortex — agent observations and application writes alike. Not storage — a transit layer. |
| **Daemon** | The background process that reads the buffer, validates, deduplicates, routes, and writes entries to the Cortex. The gatekeeper. Zero-LLM — the daemon makes no AI/LLM calls. It validates, deduplicates, routes, and writes mechanically. |
| **Offset** | The daemon's position in the buffer. "I've processed up to here." Persisted in a state file. |
| **Rotation** | Buffer cleanup. At 2MB, the JSONL file rotates. 3 files kept. Offset resets. |

## Processes

### Data In

| Term | Definition |
|---|---|
| **Observe** | The agent recognizing something worth remembering during conversation and writing an observation to the buffer. |
| **Write** | An application or developer writing to the buffer via CLI or SDK. Same pipeline as observations, different origin. |

### Data Out

| Term | Definition |
|---|---|
| **Query** | Explicit retrieval by meaning, filters, or graph traversal. Works across mind and vault. |
| **Read** | Direct entry lookup by ID or path. You know what you want. |

### Maintenance

| Term | Definition |
|---|---|
| **Decay** | Time-based importance reduction in the mind. Entries that aren't reinforced fade. Below threshold → archived. Mind only. |
| **Reinforcement** | When a buffer entry matches existing mind knowledge (by content hash), the existing entry's `last_reinforced` timestamp updates instead of creating a duplicate. Resets decay clock. |
| **Sleep Cycle** | Nightly batch job. Semantic dedup, decay processing, index rebuild, maintenance. |

### Internal (daemon pipeline)

| Term | Definition |
|---|---|
| **Validation** | Daemon checks the five required frontmatter fields, type exists in taxonomy, schema constraints met. |
| **Deduplication** | Content hash check on the write path. "Have I seen this exact content before?" |
| **Routing** | Daemon determines whether an entry goes to mind or vault, based on type→category mapping. |
| **Memorization** | The full daemon pipeline: validate → dedup → route → write → git commit. A buffer entry becomes a Cortex entry. |
| **Materialization** | Building the bidirectional graph index from `relates_to` fields across all entries. Derived, rebuildable. |

## Frontmatter Schema

**Required (Cortex-level):**

| Field | Description |
|---|---|
| `id` | UUIDv7. Globally unique. Timestamp-extractable. |
| `type` | From taxonomy. One of 17 defaults or custom. |
| `category` | Derived from type. Stored for operational convenience. concept, entity, or relation. |
| `created` | ISO timestamp. Human-readable convenience (also in UUID). |
| `source_hash` | SHA-256 content hash. For deduplication. |

**Optional (Cortex-level):**

| Field | Description |
|---|---|
| `relates_to` | List of entry IDs. Declared relations. Index materializes the bidirectional graph. |

**Separator:** `# ---` comment line divides Cortex fields (above) from application fields (below).

**Application-defined:** Everything below the separator. Cortex validates its fields and passes through the rest untouched.

## API Surface

Four operations:

| Operation | Direction | Description |
|---|---|---|
| `write` | Data In | Application/developer writes to buffer via CLI/SDK |
| `observe` | Data In | Agent writes observation to buffer during conversation |
| `query` | Data Out | Retrieval by meaning, filters, or graph traversal |
| `read` | Data Out | Direct entry lookup by ID or path |
