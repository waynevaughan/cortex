# Observation Pipeline — First Run Analysis & Fixes

Analysis of the first pipeline extraction run (1,085 observations from 66 sessions). Each section reviews a specific observation type's output, identifies problems, and proposes fixes.

This analysis informed the development of the [Cortex Knowledge Graph Taxonomy & Ontology](cortex-taxonomy.md), which defines the complete type system that emerged from this review.

---

## Analysis: Decisions (256 observations)

### What we found

**The good:** The pipeline successfully identifies real decisions with rationale and source quotes. The best observations capture the *why* behind a choice, not just the *what*. Example: "System split: Nexus (coordination) + Cortex (memory)" includes Wayne's reasoning about separation of concerns.

**Problem 1: Too many observations extracted.**
16 observations per session average. The extraction prompt says "fewer is better" but the model isn't following that guidance. It's capturing everything that *could* be a decision rather than filtering for decisions that *change future agent behavior*.

- ~30-40% are real, consequential decisions (architecture, process, design principles)
- ~40% are implementation details that belong in project docs, not standalone observations
- ~20% are misclassified — tasks, proposals, or observations labeled as decisions

**Problem 2: Severe duplication.**
"Observation Pipeline uses context-free extraction" appears 10 times. The dedup stage is failing because each extraction has slightly different wording. The dedup uses text matching (Jaccard bigrams) when it needs semantic comparison.

**Problem 3: No distinction between decision scope.**
"System split: Nexus + Cortex" (affects everything) and "Student dashboard sorts high-to-low" (affects one UI element) get similar importance scores. The pipeline has no concept of decision scope — strategic vs. tactical vs. implementation detail.

**Problem 4: Completed tasks classified as decisions.**
"Plan to download and test ClawVault" is a task, not a decision. "Proposed context window thresholds" has the word "proposed" — it's not decided yet. The extraction prompt's type definitions aren't precise enough to prevent misclassification.

### Proposed fixes

**Fix 1: Raise the extraction bar.**
Add a hard gate to the extraction prompt: "Before including any observation, answer: If an agent encountered a similar situation in 3 months, would knowing this observation change what it recommends? If no, do not extract it."

Target: 3-5 observations per session, not 16. Implementation details, one-off UI choices, and completed tasks should not pass the gate.

**Fix 2: Semantic dedup, not text matching.**
Replace Jaccard bigram dedup with embedding-based similarity. If two observations have >0.85 cosine similarity, they're duplicates. Keep the one with the higher confidence score and richer context. This requires a vector store or at minimum computing embeddings at dedup time.

Alternative (cheaper): Use the LLM itself as a dedup judge — pass candidate observations + existing vault observations and ask "are any of these duplicates?" This costs tokens but catches semantic duplicates that text matching misses.

**Fix 3: Add decision scope classification.**
Add a required field to the extraction schema:

```
"scope": "strategic" | "architectural" | "process" | "implementation"
```

- **strategic**: Affects multiple projects or the overall direction (e.g., "Nexus + Cortex split")
- **architectural**: Affects how a system is built (e.g., "sub-agents should be stateless")
- **process**: Affects how we work (e.g., "session wrap should not generate startup prompts")
- **implementation**: Affects a specific feature or detail (e.g., "dashboard sorts high-to-low")

Implementation-scope decisions should have a much higher bar for extraction. Most belong in their project's spec, not the vault.

**Fix 4: Tighten the type definitions.**
Add explicit exclusions to the "decision" type definition:

```
A decision is NOT:
- A task or plan ("we should test X" is a task, not a decision)
- A proposal that hasn't been confirmed ("proposed X" is not a decision)
- An implementation detail with no alternatives considered
- A preference (use the "preference" type instead)
```

**Fix 5: Source session tracking.**
Every observation currently says `source_session: unknown`. The daemon has the session filename — it should populate this field. Without it, we can't trace observations back to their origin, can't tell if duplicates came from the same session or different ones, and can't weight recent sessions higher.

---

## Analysis: Preferences (289 observations)

### What we found

**The good:** The pipeline correctly identifies real preferences with source quotes and context. The best ones capture Wayne's *intent* — not just what he does, but what he wants and why. Example: "Wayne wants honest feedback, not agreement" with the direct quote "don't just tell me what you think I want to hear."

**Problem 1: Duplication is worse than decisions.**
Of 289 preference observations, roughly **30-40 are unique**. The rest are duplicates with slight wording variations. Worst offenders:
- "Wayne wants honest feedback/critique, not agreement" — ~15 copies
- "Research/proposals go in separate docs, not architecture doc" — ~12 copies
- "Wayne prefers implement-test-refine over perfect upfront design" — ~10 copies
- "Observation system should be good enough, not perfect" — ~8 copies
- "Wayne values simplification over feature cramming" — ~8 copies
- "Wayne wants honest competitive analysis, not cheerleading" — ~8 copies

30%+ of all preferences are repeats. Same root cause as decisions: semantic dedup failing because text matching can't catch rephrasings.

**Problem 2: Facts misclassified as preferences.**
"Wayne tests on iPad" is observable behavior, not a stated preference. "Wayne's writing is AI-assisted" is a fact. "Wayne monitors context window on dashboard" is a behavior observation. These should be `fact` type, not `preference`. A preference requires *expressed intent* — the person stated they want something, not just that they do something.

**Problem 3: Decisions misclassified as preferences.**
"Filesystem-as-message-bus architecture for agent coordination" is a design decision. "Transition animations should stay where user's eyes are" is a design principle. The type boundary between preferences and decisions is blurry in the extraction prompt.

**Problem 4: No distinction between enduring and contextual preferences.**
"Wayne wants honest feedback" is a personality trait — it's always true. "Be conservative with SigmaRead proposals" is guidance for a specific project phase — it may expire. Both get the same treatment. Without a stability dimension, the vault can't distinguish core personality from situational guidance.

### Proposed fixes

**Fix 6: Refined preference definition.**

A preference is:
1. **Always about an entity with a mind** — human, AI agent, or any agent with wants. No mind, no preference. (Example: "Wayne prefers honest feedback" ✅. "Docker can't restrict egress on macOS" ❌ — Docker has no mind.)
2. **A property of that entity useful for predicting their behavior** — the preference itself is a fact about the entity. Its value is that it enables predictions about what the entity will want in future situations.
3. **Testable** — you can act on the prediction and be right or wrong. If you can't imagine a scenario where the prediction gets confirmed or corrected, it's too vague to be useful.

This definition applies to humans (Wayne's preferences), AI agents (Jena's behavioral patterns, Cole's tendencies), and potentially other agents. The practical scope for our pipeline is humans and AI agents.

**Quick test: Can you phrase it as "X prefers A over B"?** A preference implies a choice between alternatives. If there's no alternative being chosen, it's not a preference.

- "Wayne prefers honest feedback over softened answers" → ✅ Choice between alternatives, testable
- "Wayne prefers seeing raw output over cleaned-up results" → ✅ Choice, testable
- "Wayne prefers implement-test-refine over perfect upfront design" → ✅ Choice, testable
- "Wayne tests on iPad" → ❌ No choice implied. Observed behavior. That's a fact.
- "Claude produces slop when unsupervised" → ❌ Claude isn't choosing slop over quality. It's just what happens. That's a lesson.
- "Filesystem-as-message-bus architecture" → ❌ Not about an entity with a mind. That's a decision.
- "Wayne values simplicity" → ⚠️ Too vague. Sharpen to: "Wayne prefers simplification over adding features from competitive analysis."

**Wanting vs. behaving:** A preference requires that the entity *wants* A over B — not just that it *does* A. "Claude produces over-engineered slop when unsupervised" is an observed behavior pattern (lesson/fact). "Claude prefers to produce over-engineered slop" would be a preference — but it's wrong, because Claude doesn't *want* that. The distinction is wanting vs. behaving.

**Relationship to lessons:** Lessons can generate preferences. We hit a problem (lesson about the world), and a human says "don't do that again" (preference — a want). The lesson is "unsupervised Claude sessions produce slop." The preference it generates is "Wayne wants sub-agent tasks scoped tightly" (Wayne prefers tight scoping over open-ended autonomy).

**Fix 7: Preference stability classification.**
Add a required field:

```
"stability": "enduring" | "contextual"
```

- **Enduring** — personality traits, values, communication style, working methodology. Always true. High retention priority. Examples: "wants honest feedback," "prefers simplification," "expects autonomy"
- **Contextual** — project-specific, phase-specific, situation-specific. True within a scope. Should carry scope tags and may expire. Examples: "be conservative with SigmaRead proposals," "ClawVault website as design reference"

**Fix 8: Preferences route primarily to Memories partition.**
In the Memories vs Structured Data framework, preferences are the primary input to Memories. They shape agent behavior implicitly — they should be loaded at session start as part of the agent's behavioral model, not stored as standalone vault docs alongside architecture specs.

The ideal output: ~25-30 high-quality, deduplicated preference observations that form a rich behavioral model. "Wayne iterates through analysis before design. Wayne wants honest pushback. Wayne values simplification. Wayne expects autonomy. Wayne wants to see raw output before I act on it."

**Fix 9: Cross-type dedup.**
"Wayne wants honest competitive analysis, not cheerleading" appeared as BOTH a preference and a decision. The dedup pass should operate across types, not just within them. If the same insight appears as both a preference and a decision, keep whichever type fits better and discard the other.

### The preference usefulness test

**"Does knowing this change how I behave?"**

- ✅ "Wayne wants honest feedback" → changes my output style in every response
- ✅ "Wayne expects agent to figure things out independently" → changes when I ask vs. just do
- ✅ "Wayne's iterative process: analyze, accumulate, simplify" → changes how I approach design sessions
- ❌ "Wayne tests on iPad" → doesn't change my behavior (unless I'm building UI, and then it's a fact I'd search for)
- ❌ "ClawVault website as design reference" → one-time project context, not behavioral

## Analysis: Lessons (236 observations)

### What we found

**The good:** Lessons are the most practically useful observation type. The best ones are things I'd genuinely want to know in a future session: "When resetting user state, delete all correlated data," "npx tsx buffers stdout until process completion," "NIAH benchmarks overstate usable long-context for agents." These are hard-won operational knowledge that prevents repeating mistakes.

**Problem 1: Duplication is the worst of any type.**
The self-referential observation problem compounds here. The observer daemon's own failures generated lessons about itself, which then got duplicated across sessions:
- "Observer promoter git race condition" — **~10 copies**
- "Gateway SIGUSR1 restart does not reset session" — **~8 copies**
- "Observer pipeline extracts too much, curates too little" — **~8 copies**
- "Built and tested observer daemon but never deployed it" — **~7 copies**
- "Context limit exceeded causes session handoff failure" — **~6 copies**
- "Observer daemon produced 1085 observations with quality issues" — **~5 copies**
- "Wayne's relationship with Cole is a meaningful partnership" — **3 copies** (also appeared in preferences — cross-type dup)

Rough estimate: of 236 lessons, **70-90 are unique**. The rest are duplicates. That's 60%+ noise.

**Problem 2: Three distinct categories lumped together.**
The lessons fall into clearly different buckets that serve different purposes:

**Technical gotchas** (how tools/systems actually behave):
- "npx tsx buffers stdout until process completion"
- "Node.js v25.5 in sandbox treats .js as ESM by default"
- "Docker Desktop macOS cannot restrict container network egress with iptables"
- "QMD query cold-start takes ~15-16s, always times out with default 4s timeout"

**Operational patterns** (how to work effectively in our environment):
- "When resetting user state, delete all correlated data"
- "Sub-agents need JSONL format documented in task instructions"
- "Always check git history after removing sensitive files, not just HEAD"
- "LLM prompts saying 'about 5-6 exchanges' get ignored; use hard limits"

**Meta-lessons** (higher-order insights about how we work):
- "Unsupervised Claude sessions produce over-engineered slop"
- "Cole tends to over-architect — use critique process to simplify"
- "Built engine but never turned the key — deploy before designing v2"
- "Self-critique proposals before presenting to decision-maker"

These serve fundamentally different retrieval patterns. A technical gotcha is searched when encountering a specific tool/error. An operational pattern is loaded when starting certain types of work. A meta-lesson shapes behavior broadly, like a preference.

**Problem 3: Self-referential noise.**
The observer observing its own failures is both hilarious and a real quality problem. "Observer daemon parser fails on non-raw JSON LLM responses" is a valid lesson — once. Having it appear 5+ times across different wording pollutes the vault. Worse, these lessons about the observer's *current* bugs become stale the moment we fix them.

**Problem 4: Staleness risk.**
Technical lessons can become wrong. "Node.js in sandbox defaults to ESM modules" might change with a Node version update. "QMD query cold-start takes ~15-16s" might get fixed. Unlike preferences (which are about a person) or decisions (which capture a choice in time), lessons can expire silently — and a stale lesson is worse than no lesson because it actively misleads.

### Proposed fixes

**Fix 10: Lesson subcategories.**
Split `lesson` into three subtypes with different retention and retrieval strategies:

```
"subtype": "technical" | "operational" | "meta"
```

- **Technical** — tool/system behavior gotchas. Retrieved by searching for specific tools/errors. Should have `expires` or `verified_date` metadata because technical facts go stale. Route to **Structured Data**.
- **Operational** — how to work effectively. Retrieved when starting certain types of tasks. Moderately stable. Route to **Structured Data** with scope tags.
- **Meta** — higher-order insights about work patterns and agent behavior. Retrieved implicitly. Highly stable. Route to **Memories** (they function like preferences — they shape behavior).

**Fix 11: Staleness metadata.**
Add optional fields for lessons that can expire:

```
"verified_date": "2026-02-15"
"expires": "2026-08-15"        # optional, for time-bound technical facts
"applies_to": "node-v25"       # optional, for version-specific lessons
```

The pipeline or a periodic maintenance job should flag lessons older than N months for re-verification. A lesson that hasn't been verified in 6 months should drop in retrieval priority.

**Fix 12: Self-referential filter.**
Add an extraction-time gate: observations about the observation pipeline itself should be flagged and held for separate review, not automatically added to the vault. The pipeline should not be its own most prolific subject. Implementation: check if entity tags include `observer`, `pipeline`, `promoter`, `cortex-daemon` — if so, flag for manual review or route to a maintenance log instead of the main vault.

**Fix 13: Refined lesson definition.**

**A lesson is a truth about the world that directly and predictably changes future behavior.**

Three parts:
1. **About the world** — not about an entity's wants (that's a preference)
2. **Learned from experience** — it came from something that happened, not from someone stating a want
3. **Directly and predictably changes future behavior** — you can specifically say what you'll do differently. If the behavioral change is vague or indirect, it's a fact, not a lesson.

**Quick test:** "Because I learned X, next time I will specifically do Y."

If Y is concrete and predictable → lesson. If Y is vague or uncertain → fact.

**Distinguishing lessons from facts:** Every fact *could* theoretically change future behavior, often in ways that aren't knowable. A lesson has a strong, direct, predictable correlation to changes in future behavior. "npx tsx buffers stdout" → "next time I'll write to a log file" (direct, predictable = lesson). "AI improves learning rates by 2x" → "I'll... do something?" (vague, indirect = fact).

**Distinguishing lessons from preferences:** A lesson is about the world. A preference is about an entity with a mind and its wants. Lessons can *generate* preferences: we hit a problem (lesson), Wayne says "don't do that again" (preference). "Unsupervised Claude sessions produce slop" is a lesson (truth about Claude's behavior, no want implied). "Wayne wants sub-agent tasks scoped tightly" is the preference it generated.

**Extraction gate examples:**
- ✅ "npx tsx buffers stdout" → next time I'll use a log file. Direct, predictable.
- ✅ "LLM prompts saying '5-6 exchanges' get ignored; use hard limits" → next time I'll use hard token/turn limits. Direct.
- ✅ "Unsupervised Claude sessions produce slop" → next time I'll scope sub-agent tasks tightly. Direct.
- ❌ "Observer daemon produced 1085 observations" → historical event, no predictable behavioral change.
- ❌ "AI improves learning rates by 2x" → behavioral change is vague. That's a fact.

## Analysis: Facts (257 observations) → Reframed as Information Hierarchy

### The hierarchy: Information → Facts → Opinions → Beliefs

Analysis of the 257 "fact" observations revealed that the pipeline was lumping together fundamentally different kinds of knowledge. Drawing from neuroscience and information theory, we identified a hierarchy that changes how Cortex should categorize and store observations.

**Information** is raw signal — anything that reduces uncertainty. In Cortex, this is session transcripts, tool outputs, log files. Information is the *input* to the pipeline, not the output. It's already preserved in session JSONL files. The pipeline's job is to extract higher-order knowledge from information. **We do not store information as observations.**

**Facts** are discrete pieces of information, produced by a mind, that attempt to accurately describe reality. Facts can be wrong — they are representations, not reality itself. They can be verified against reality and corrected.

Definition: **A fact is a discrete piece of information that attempts to accurately describe the state of some part of reality. Individual facts may seem low-value, but collectively they provide essential context — the map the agent needs to operate.**

- "SigmaRead has 10 active students across 5 reading levels" ✅ fact
- "Discord channel ID is 1470820353088557283" ✅ fact
- "OpenClaw 2026.2.9 fixes post-compaction amnesia" ✅ fact

**Opinions** are evaluative judgments made by a mind, backed by evidence or reasoning. Opinions go beyond describing reality — they *interpret* it. They engage both cognitive evaluation and value systems. An opinion without attribution is dangerous because it looks like a fact.

Definition: **An opinion is an evaluative judgment by an identified entity, backed by evidence or reasoning, that interprets rather than merely describes reality. Opinions always have an author.**

- "ClawVault's single-call approach doesn't scale" ✅ opinion (Cole's assessment after code analysis)
- "The pipeline extracts too much, curates too little" ✅ opinion (Cole + Wayne's evaluation)
- "Earlier compass architecture repo was low-quality slop" ✅ opinion (Wayne's judgment)

**Beliefs** are convictions held by a mind, not necessarily backed by proportional evidence. Beliefs function as strong priors — they shape how facts are interpreted and opinions are formed. The belief comes first; evidence is filtered through it. Beliefs are the most persistent knowledge type and the hardest to change.

Definition: **A belief is a conviction held by an identified entity that functions as a prior — it shapes how other knowledge is interpreted rather than being derived from evidence. Beliefs are the deepest, most stable layer of an entity's worldview.**

- "The moat is data and iteration, not software" ✅ belief (Wayne's strategic conviction)
- "AI should feel like working with a real person" ✅ belief (Wayne's vision)
- "Working with an AI should feel like working with a real person" ✅ belief (core Cortex thesis)

### How this changes the pipeline

**Different extraction patterns:**
- **Facts** are the easiest to extract — discrete, specific, usually stated plainly. High volume, low individual value, high collective value.
- **Opinions** can be extracted from a single exchange — someone evaluates something and states their judgment. Medium volume. Must include attribution and evidence.
- **Beliefs** are the hardest to extract — they emerge over many conversations as patterns, not from single statements. Low volume, highest individual value. The pipeline may need a separate "belief detection" pass that looks across multiple sessions rather than within a single chunk.

**Different update dynamics:**
- **Facts** — most volatile. Change whenever reality changes. Need freshness/verification tracking. A fact from 3 months ago may be wrong today.
- **Opinions** — medium stability. Change when new evidence appears or reasoning evolves.
- **Beliefs** — most stable. Rarely change. High resistance to updating. When a belief *does* change, it's a significant event worth capturing.

**Different routing (Memories vs Structured Data):**
- **Facts** → primarily **Structured Data**. They're reference material — searched when doing work, not loaded implicitly. "The channel ID is X" is something I look up, not something that shapes my behavior.
- **Opinions** → **both**. Some shape agent behavior ("ClawVault doesn't scale" → I won't recommend their approach). Some are project-specific evaluations stored for reference.
- **Beliefs** → primarily **Memories**. They're the deepest behavioral shapers. Wayne's beliefs about education, simplicity, and AI filter every decision. They should be loaded at session start because they color everything.

**Beliefs may be the highest-leverage observation type.** If the agent deeply understands an entity's beliefs, it can predict their reaction to situations that have never been discussed. Beliefs are the generative model from which preferences and opinions flow. They're the hardest to extract but the most valuable to have.

### Proposed fixes

**Fix 14: Split "fact" type into facts, opinions, and beliefs.**
The current `fact` type conflates three fundamentally different kinds of knowledge. Split into:
- `fact` — discrete description of reality state, verifiable
- `opinion` — evaluative judgment, requires attribution + evidence
- `belief` — conviction/prior, requires attribution, emerges across sessions

**Fix 15: Mandatory attribution for opinions and beliefs.**
Opinions and beliefs must always record *whose* opinion or belief it is. An unattributed opinion stored in the vault gets treated as ground truth by future agents — that's dangerous. Schema:
```
"attribution": "wayne-vaughan" | "cole" | "jena-chela"
"evidence": "optional — what supports this opinion"
```

**Fix 16: Freshness tracking for facts.**
Facts are the most volatile observation type. Add:
```
"observed_date": "2026-02-15"
"verified_date": "2026-02-15"    # last confirmed accurate
```
Facts older than N months without re-verification should drop in retrieval priority. A stale fact is worse than no fact because it actively misleads.

**Fix 17: Cross-session belief extraction.**
Beliefs rarely emerge from a single conversation. The pipeline should have a periodic "belief synthesis" pass that looks across multiple sessions for recurring patterns in an entity's reasoning. This is fundamentally different from per-session extraction and may need to be part of the consolidation process rather than the observation pipeline.

### Problems found in the 257 "fact" observations

**Duplication (same as every other type):**
- "Cortex positioning: agent infrastructure, not consumer app" — ~10 copies
- "Wayne's broader vision: Sigma School, Compass, The Sigma Company" — ~7 copies
- "ClawVault.dev is the correct domain" — ~5 copies

**Misclassified opinions stored as facts:**
- "ClawVault single-call approach doesn't scale" — that's an opinion (evaluative judgment)
- "Earlier compass architecture repo was low-quality slop" — opinion
- "Memories shape agent behavior beyond human interaction" — this is a design principle/belief, not a fact

**Low-value operational details:**
- "Heartbeat system uses conversation_label 359174372302389258" — config detail that belongs in a config file, not the knowledge vault
- "QMD vault path corrected from X to Y" — transient operational detail
- Many observations are just recording config values or file paths that are better stored in actual config files

## Analysis: Projects

*(Pending)*

## Analysis: Milestones

*(Pending)*

## Analysis: Relationships

*(Pending)*

---
