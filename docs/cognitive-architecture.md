# Cortex Cognitive Architecture

How Cortex processes knowledge — and why it mirrors the brain.

---

## The Sensory Buffer Analogy

The human brain doesn't store everything it encounters. Sensory input passes through a rapid triage pipeline:

```
Stimulus → Sensory Buffer → Working Memory → Long-Term Memory
              (~250ms)        (~30 seconds)      (permanent)
              raw signal      held + evaluated    encoded + indexed
              most decays     some promoted       retrieved by cue
```

**Sensory buffer** (iconic/echoic memory): Raw input floods in — sights, sounds, touch. The vast majority decays within milliseconds. Only signals that pass an attention gate move to working memory.

**Working memory**: A small number of items are held actively. The brain evaluates them — is this important? Does it connect to something I already know? Is it actionable? Items that pass this evaluation get encoded into long-term storage. The rest fade.

**Long-term memory**: Durable, indexed, retrievable by association. Not stored as raw data — stored as *meaning*, organized by type (episodic memory for events, semantic memory for facts, procedural memory for skills).

Cortex follows this same pipeline.

---

## How Cortex Maps to This

```
Conversation → Observation (staging) → Typed Knowledge → Vault
                 sensory buffer          working memory     long-term memory
                 raw signal              classified         indexed + retrievable
                 must resolve or decay   concept/entity/    persisted across sessions
                                         relation
```

### Stage 1: Observation (Sensory Buffer)

During conversation, the agent encounters information constantly — user statements, implied preferences, decisions made, context mentioned. Most of this is transient. The agent's first job is **attention gating**: does this signal matter beyond this conversation?

An observation at this stage is unclassified raw signal. It's the agent saying "I noticed something" before it knows what that something *is*.

Like the brain's sensory buffer, observations at this stage are **temporary by design**. They must either resolve into a typed knowledge entry or be pruned. There is no permanent "unclassified" bucket — that would be hoarding, not learning.

### Stage 2: Classification (Working Memory)

The agent classifies the observation into one of three **categories** and 21 **types**:

| Category | What it represents | Types |
|---|---|---|
| **Concept** | Ideas the agent holds | idea, opinion, belief, preference, lesson, decision, commitment, goal_short, goal_long, aspiration, constraint |
| **Entity** | Things in the world | fact, document, person, milestone, task, event, resource |
| **Relation** | Connections between things | project, dependency |

This classification isn't arbitrary filing — it determines how the knowledge behaves:

- **Concepts** get reasoned about, challenged, updated, and contradicted. They participate in the agent's thinking.
- **Entities** get tracked, referenced, and linked to. They anchor the agent's model of the world.
- **Relations** get traversed. They're how the agent understands structure — what depends on what, what belongs to what.

The category tells the system *how to use* the knowledge, not just where to store it.

### Stage 3: Vault (Long-Term Memory)

Classified observations that pass quality gates are written to the vault — Cortex's durable knowledge store. Like long-term memory in the brain, vault entries are:

- **Indexed by association**, not location — retrieved by semantic similarity, not file path
- **Stored as meaning**, not raw transcript — the observation captures the *insight*, not the conversation that produced it
- **Retrievable across sessions** — an observation from February shapes behavior in March
- **Subject to consolidation** — batch processes (the "sleep cycle") merge duplicates, resolve contradictions, and prune low-value entries, just as the brain consolidates memories during sleep

---

## Why This Matters for Developers

If you're building on Cortex or extending the taxonomy, this architecture has practical implications:

**1. Don't skip the staging step.** It's tempting to write directly to the vault. But the sensory buffer exists for a reason — it forces classification, which forces the agent to understand *what kind of knowledge this is*. Unclassified knowledge is unusable knowledge.

**2. Categories are behavioral, not cosmetic.** The concept/entity/relation split isn't just an organizational convenience. It determines retrieval strategy, graph topology, and how the agent reasons about the knowledge. A `decision` (concept) behaves differently in the system than a `milestone` (entity), even if they're about the same thing.

**3. Decay is a feature.** Not everything deserves to persist. The brain forgets most sensory input — that's not a bug, it's compression. Observations that can't be classified are noise, and pruning them keeps the vault signal-dense.

**4. The taxonomy is extensible within structure.** New types can be added, but each must belong to a category. This forces the question: "Is this an idea, a thing, or a connection?" — which prevents type sprawl and ensures new types integrate cleanly with retrieval and reasoning.

---

## The Ontological Foundation

The three categories — concept, entity, relation — mirror a foundational split in knowledge representation known as the **ontological triad**:

| Tradition | Ideas | Things | Connections |
|---|---|---|---|
| **Philosophy** | Propositions | Substances | Relations |
| **Neuroscience** | Semantic memory | Episodic memory | Associative networks |
| **Knowledge graphs** | Attributes | Nodes | Edges |
| **OOP** | Values | Objects | References |
| **Cortex** | Concepts | Entities | Relations |

This isn't a coincidence. It appears to be how structured knowledge *wants* to organize itself — the minimum viable ontology for any system that needs to store, retrieve, and reason about what it knows.

Cortex doesn't invent this structure. It adopts it deliberately, with the specific purpose of giving AI agents the same cognitive architecture that makes biological intelligence effective: attend, classify, store, retrieve, reason, forget.
