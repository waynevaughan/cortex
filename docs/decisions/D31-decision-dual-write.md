# D31: Decision Dual-Write Pattern

**Date:** 2026-02-17
**Status:** Adopted
**Participants:** Wayne, Cole

## Decision

Decisions stay categorized as `concept` with no routing overrides. When the agent judges a decision is consequential enough to observe, it writes multiple queue entries:

1. **Concept** (Mind) — The behavioral record. Shapes how the agent thinks and acts. Subject to decay.
2. **Record** (Vault) — The permanent artifact. Who decided, when, why, what alternatives existed, who was involved. Never decays.
3. **Relation** (Vault, optional) — For multi-party decisions/agreements. Connects the people involved through the shared choice.

All intelligence lives in the agent at write time. The daemon processes each entry mechanically — no special-case routing logic.

## Rationale

- Not every decision is worth recording. "I decided to eat eggs" never enters the system. "I decided to build Cole" does. The agent applies this judgment.
- Consequential decisions are permanent record — they should never decay. But the behavioral influence of a decision (in Mind) can fade if it becomes irrelevant over time.
- Decisions often involve multiple parties (agreements). The agent has conversational context to recognize this and write the relation.
- Category routing stays pure — no type-specific overrides in the daemon.

## What This Replaced

The pipeline walkthrough originally flagged a "decision routing ambiguity" — decisions are concepts (route to Mind) but seem like permanent records (should route to Vault). Three options were considered:
- A. Override: all decisions → Vault (breaks category purity)
- B. Strict: all decisions → Mind (loses permanent record)
- C. Split: behavioral vs architectural decisions (requires distinguishing field)

Wayne proposed a fourth option: dual-write. The agent writes both, connected by a relation. This preserves category purity while ensuring permanent records exist.

## Key Insight

Decisions can have relational properties — they connect entities (people, projects) through shared choices. This relational aspect is a *property* of the decision, not what the decision *is*. The decision remains a concept. The relation is expressed through entity references and explicit relation entries, which the graph materializes.
