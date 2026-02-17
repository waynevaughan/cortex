# D32: Vault and Mind Directory Structure

**Date:** 2026-02-17
**Status:** Adopted
**Participants:** Wayne, Cole

## Decision

Both Mind and Vault organize by type. UUIDv7 filenames (D24) provide chronological ordering.

```
mind/
  idea/
  decision/
  preference/
  belief/
  lesson/
  opinion/
  commitment/
  goal_short/
  goal_long/
  aspiration/
  constraint/

vault/
  fact/
  document/
  person/
  milestone/
  task/
  event/
  resource/
  project/
  dependency/
  decision/          ← decision records from dual-write (D31)
```

Type directories are created by the daemon on first write. UUIDv7 filenames sort chronologically by default.

## Rationale

- Mind organizes by type like brain regions — specialized areas for different kinds of knowledge
- Vault organizes by type for human browsability (`ls vault/person/` shows all people)
- The index spans everything, so agents retrieve via query regardless of directory structure
- Simple, predictable, no routing complexity

## Explored and Deferred: Vault Partitioning

During this conversation, we explored separating the vault into agent-owned and application-owned partitions:

```
vault/
  mind/         ← agent's permanent records
  {app}/        ← application-owned data
```

**The principle is sound** — agent data and application data serve different audiences and shouldn't be co-mingled. However, we identified five problems with implementing it now:

1. **Naming confusion** — `mind/` at top level and `vault/mind/` creates ambiguity about what "mind" means
2. **Blurry entity boundaries** — A `person` entity like "Wayne" serves both the agent and applications. Which partition owns it?
3. **No applications yet** — Currently one agent, zero independent applications. Multi-tenant design for single-tenant reality is premature.
4. **Routing complexity** — Daemon would need to distinguish agent writes from app writes using a new field
5. **Dual-write already solves it** — Decision records in vault are already linked from mind concepts. No special partition needed for the agent to find them.

**When to revisit:** When a second consumer of the vault appears (an application writing its own data), partition the vault then. The type-based structure makes this a non-breaking change — add `vault/{app}/` alongside existing type directories.
