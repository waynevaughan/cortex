# Observation Pipeline — Issues & Fixes

Working document. Built by analyzing the raw output of the first pipeline run (1,085 observations from 66 sessions). Each section corresponds to an observation type we reviewed. Decisions accumulate here as we work through the data.

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

## Design Principle: Type-Specific Quality Gates

**Observation from Wayne:** Determining whether an observation is important, useful, and worthy of committing to the vault is *specific to the type of observation*. The criteria for a good decision is different from the criteria for a good preference, which is different from a good fact.

**Implication:** The pipeline should not use a single universal quality gate. Each observation type needs its own:
- **Extraction criteria** — what makes this type worth extracting?
- **Quality bar** — what separates a vault-worthy observation from noise?
- **Dedup strategy** — how do duplicates manifest for this type?
- **Usefulness test** — how would an agent use this type of observation?

This adds complexity to the pipeline (type-specific evaluation logic instead of one-size-fits-all scoring), but should produce significantly better results. A preference that says "Wayne hates corporate filler" has a completely different quality profile than a decision that says "We chose Postgres over MongoDB."

**Where this fits in the pipeline:** After extraction and type classification, observations should route through type-specific evaluation before scoring. The current pipeline applies the same confidence/importance formula to everything — that's likely why implementation-detail decisions score similarly to strategic ones.

We'll define the specific criteria for each type as we analyze them below.

---

## Design Principle: The Knowledge Graph Split

**Observation from Wayne:** The knowledge graph should split into two fundamentally different regions, distinguished by audience and purpose:

**(a) The agent's mind** — everything the agent needs to operate. This includes both memories (preferences, beliefs, lessons, interaction patterns) and structured data the agent uses to do work (project architectures, dependency maps, technical context). The agent organizes this however it sees fit. The agent decides what goes in, how it's structured, and what matters — optimized for whatever the agent believes it needs to perform its work effectively. This is not a human-curated knowledge base. It's the agent building its own cognitive infrastructure. Humans never see this directly and don't need to.

Examples: "Wayne pushes back on complexity, prefers simplification." "When Wayne says 'proceed' he means stop discussing and execute." "Cortex uses SQLite — relevant for all technical decisions." "The pipeline has 18 observation types organized into cognitive and operational groups."

**(b) The human's computer** — well-organized information that humans can search, browse, and use. Think of it like a file system, a wiki, a project tracker. Project descriptions, architecture documents, research reports, task lists, contacts. Organized in familiar hierarchies that humans expect — files and folders, categories and tags. The organizing principle is: what does the human need to find and use?

Examples: Nexus renders a task list for Wayne to review. Explorer shows the knowledge graph for humans to browse. A project spec is formatted for human reading.

**The key distinction:** The split is by **audience and purpose**, not by data type. The agent's mind is organized *by the agent, for the agent* — whatever the agent needs to do its job. The human's computer is organized for human consumption — browsable, navigable, structured in ways humans expect.

The same information can live in both. "Cortex uses SQLite" might be in the agent's mind (for making technical decisions) and in the human's computer (in a project architecture doc Wayne can review). The agent's mind is a superset in some ways — it contains things humans would never care about ("Wayne gets frustrated when I over-explain") alongside things humans do care about (project specs).

**How observation types route into this:**

- **Memories and agent-facing knowledge** are retrieved *implicitly* — loaded at session start, used to shape tone, approach, and decision-making. The agent doesn't search for "does Wayne like bullet points?" — it just *knows*. The format optimizes for LLM absorption. The quality bar is "does this make me a better agent?"

- **Human-facing knowledge** is retrieved *explicitly* — searched when doing work, queried by tools, rendered for humans through familiar interfaces. The format needs to be human-readable. The quality bar is "is this accurate, current, and organized so a human can find it?"

The 18 observation types serve as a routing guide. Cognitive types (fact, opinion, belief, preference, lesson, decision, commitment, risk, goals, aspiration) route predominantly to the **agent's mind** — they shape how the agent thinks and operates. Operational types (constraint, project, milestone, task, resource, event, dependency) often appear in **both** — the agent needs them for work, and humans need visibility into them.

**Key insight:** A single observation can produce both. "We chose Postgres over MongoDB because Wayne values simplicity and local-first" contains agent knowledge (Wayne values simplicity — shapes future decisions) and human-facing knowledge (the project uses Postgres — belongs in the architecture doc). One extraction, two destinations.

**Where this fits in the pipeline:** After extraction and type classification, observations are *routed* based on audience and purpose. The type classification informs routing but doesn't determine it rigidly — context matters. This is a routing/destination concern, not a type classification concern.

**Open question:** Whether this needs two physically separate stores vs. two logical views of one store is an implementation question. The conceptual split is sound from first principles — it mirrors how human cognition works. What you know implicitly (how to interact with the world) and what you keep in organized files (documents, notes, references) serve different purposes and are accessed differently.

---

## Observation Type Definitions (Agent Prompt Format)

Observation types are organized into two groups:

**Cognitive Observation Types** — products of minds. These require an entity with a mind to exist. They describe how minds model reality, form judgments, hold convictions, want things, learn from experience, commit to choices, and direct toward future states. Nine types: fact, opinion, belief, preference, lesson, decision, goal (short-term), goal (long-term), aspiration.

**Operational Observation Types** — practical structures and boundaries for organizing and constraining work. These are not products of minds, though minds recognize and create them. They describe how work is organized, tracked, and bounded. Types: constraint, and others to be defined (project, milestone, task, relationship under discussion).

Each cognitive type follows the same structure: definition, three parts, what it's NOT, quick test, examples.

Eleven cognitive types: fact, opinion, belief, preference, lesson, decision, commitment, risk, goal (short-term), goal (long-term), aspiration.

---

### fact

A fact is a discrete piece of information that attempts to accurately describe the state of some part of reality.

Three parts:
- **Discrete** — a single, specific piece of information. Not a conclusion, not a want, not a behavioral change.
- **Describes state** — it tells you what is, not what should be or what someone wants.
- **Collectively provides context** — individual facts may seem low-value, but together they form the map of reality the agent needs to operate.

What a fact is NOT:
- Not a preference (no entity wanting A over B)
- Not a lesson (no direct, predictable behavioral change)
- Not a decision (no choice between alternatives)
- Not an opinion (no evaluation or judgment)

Quick test: "This is how things are." No evaluation, no want, no behavioral change implied.

Examples:
- ✅ "SigmaRead has 10 active students across 5 reading levels."
- ✅ "The Vercel project is linked under the sigmascore scope."
- ✅ "OpenClaw 2026.2.9 fixes post-compaction amnesia."

---

### opinion

An opinion is an evaluative judgment by an identified entity, backed by evidence or reasoning, that interprets rather than merely describes reality.

Three parts:
- **Evaluative** — it goes beyond describing what is to judging what it means. It interprets, assesses, or concludes.
- **Attributed** — it always has an author. An opinion without attribution is indistinguishable from a fact, and that's dangerous.
- **Evidence-backed** — it is supported by reasoning or evidence, even if that reasoning could be challenged.

What an opinion is NOT:
- Not a fact (facts describe state without evaluation)
- Not a belief (beliefs are held without proportional evidence — they are priors, not conclusions)
- Not a decision (decisions commit to action — opinions evaluate without necessarily acting)

Quick test: "X thinks Y about Z, because of evidence." Remove the author and evidence, and it shouldn't stand on its own.

Examples:
- ✅ "Cole assessed that ClawVault's single-call extraction doesn't scale, based on analyzing their chunking approach."
- ✅ "Wayne judged the earlier Compass repo as low-quality, based on reviewing the output."
- ✅ "Cole and Wayne concluded the pipeline extracts too much and curates too little, based on auditing 1,085 observations."

---

### belief

A belief is a conviction held by an identified entity that functions as a prior — it shapes how other knowledge is interpreted rather than being derived from specific evidence.

Three parts:
- **Conviction** — it is held with certainty, not tentatively. It is a deep assumption about how things are or should be.
- **Prior, not conclusion** — it is not derived from specific evidence. It shapes how evidence is interpreted. The belief comes first; evidence is filtered through it.
- **Attributed** — it always belongs to a specific entity. Beliefs are the deepest, most stable layer of an entity's worldview.

What a belief is NOT:
- Not an opinion (opinions are derived from evidence — beliefs are the priors that shape how evidence is evaluated)
- Not a preference (preferences are about wanting A over B — beliefs are about what is fundamentally true)
- Not a fact (facts attempt to describe reality objectively — beliefs are subjective convictions)

Quick test: "X holds that Y is true" — where Y is not derived from specific evidence but from conviction.

Examples:
- ✅ "Wayne believes the moat is data and iteration, not software."
- ✅ "Wayne believes working with AI should feel like working with a real person."
- ✅ "Wayne believes education should be designed for how students learn, not how classrooms operate."

---

### preference

A preference is a property of an entity with a mind that is useful for predicting that entity's behavior. A preference implies a choice — the entity wants A over B.

Three parts:
- **Entity with a mind** — preferences belong to humans, AI agents, or any entity with wants. No mind, no preference.
- **Useful for prediction** — the preference is valuable because it enables predicting what the entity will want in future situations.
- **Implies a choice** — the entity wants A over B. If it cannot be phrased as "X prefers A over B," it is not a preference.

What a preference is NOT:
- Not a fact (facts describe state without implying a want)
- Not a lesson (lessons are about the world, not about an entity's wants)
- Not a belief (beliefs are convictions about what's true — preferences are about what's wanted)
- Not observed behavior without a want (if someone does X but doesn't want X, that's a fact, not a preference)

Quick test: "X prefers A over B." If it can't be phrased that way, it's not a preference.

Examples:
- ✅ "Wayne prefers honest feedback over softened answers."
- ✅ "Wayne prefers implement-test-refine over perfect upfront design."
- ✅ "Wayne prefers simplification over adding features from competitive analysis."

---

### lesson

A lesson is a truth about the world, learned from experience, that directly and predictably changes future behavior.

Three parts:
- **About the world** — not about an entity's wants (that's a preference) or an entity's convictions (that's a belief).
- **Learned from experience** — it came from something that happened, not from someone stating a want or a conviction.
- **Directly and predictably changes future behavior** — you can specifically say what you'll do differently. If the behavioral change is vague or indirect, it's a fact, not a lesson.

What a lesson is NOT:
- Not a preference (preferences are about wants — lessons are about the world)
- Not a fact (facts may or may not change behavior — lessons have a strong, direct, predictable correlation to behavioral change)
- Not a decision (decisions are choices — lessons are discoveries)

Quick test: "Because I learned X, next time I will specifically do Y." If Y is concrete and predictable, it's a lesson. If Y is vague or uncertain, it's a fact.

Examples:
- ✅ "npx tsx buffers stdout until process completion — next time, write to a log file instead of polling."
- ✅ "LLM prompts saying 'about 5-6 exchanges' get ignored — use hard token or turn limits instead."
- ✅ "Unsupervised Claude sessions produce over-engineered slop — next time, scope sub-agent tasks tightly with explicit constraints."

---

### decision

A decision is a choice between alternatives that directs future action.

Three parts:
- **Choice** — alternatives existed, and one was selected over the others.
- **Commitment** — the choice has been made. It is not a proposal, suggestion, or consideration.
- **Directs action** — something changes because of this choice. Future work proceeds differently than it would have otherwise.

What a decision is NOT:
- Not a proposal ("we should consider X" — no commitment has been made)
- Not a completed task ("we tested ClawVault" — that's an event, not a choice)
- Not an opinion ("ClawVault doesn't scale" — that's an evaluation without a choice and commitment to act)

Quick test: "We chose A over B, and action followed." If no choice was made, or no action was directed, it's not a decision.

Examples:
- ✅ "We split the system into Nexus (coordination) and Cortex (memory) instead of building a monolith."
- ✅ "Context window operational cap set to 500K tokens instead of using the full 1M."
- ✅ "Sub-agents should be stateless — the orchestrator holds all memory."

---

### commitment

A commitment is a deliberate declaration of intent by an intelligent entity to do or be something, carrying an implied accountability for follow-through.

Three parts:
- **Deliberate declaration** — it is a conscious, specific act of binding oneself. Not a passing thought, idle speculation, or vague wish. The entity has chosen to pledge.
- **Specific intent** — the commitment declares something concrete enough that follow-through (or failure to follow through) can be recognized. Vague expressions of interest are not commitments.
- **Implied accountability** — if the entity doesn't follow through, the commitment has been broken. A commitment creates an expectation — of oneself or others — that distinguishes it from a whim or a preference.

Commitments can attach to many things:
- A task — "I'll deliver the report by Friday"
- A goal — "I'm going to lose 20 pounds by December"
- A relationship — "I commit to this partnership"
- An event — "I'll be at the meeting"
- A behavior — "I'm done procrastinating on this"

What a commitment is NOT:
- Not a goal (a goal is a desired future state — a commitment is the declaration of intent to pursue it. You can have goals without committing to them.)
- Not a preference (a preference predicts what someone wants — a commitment declares what someone will do)
- Not a decision (a decision is a choice between alternatives — a commitment is a pledge to act. A decision may lead to a commitment, but not all decisions are commitments.)
- Not a whim or musing ("we should probably look into that" carries no accountability — it's not a commitment)

Quick test: "X has pledged to do Y, and would be accountable if they don't follow through." If there's no accountability, it's not a commitment.

Examples:
- ✅ "I'll have the results by Friday."
- ✅ "I'm going to lose 20 pounds by December."
- ✅ "I commit to attending every standup this quarter."
- ❌ "We should probably test that at some point." — vague, no accountability.
- ❌ "Maybe I'll start running." — no specificity, no pledge.
- ❌ "It would be nice to have better documentation." — a wish, not a commitment.

---

### risk

A risk is an opinion about the severity and likelihood of a failure mode.

Three parts:
- **Opinion** — it is an evaluative judgment by an identified entity. It requires attribution. Different entities may assess the same failure mode differently.
- **Severity** — how bad the consequences would be if the failure mode occurs.
- **Likelihood** — how probable it is that the failure mode occurs.

What a risk is NOT:
- Not a fact (facts describe current state — risks evaluate potential failure)
- Not a constraint (constraints are current boundaries — risks are potential future problems)
- Not a lesson (lessons are learned from past experience — risks are about what hasn't happened yet)

Quick test: "X believes there is a [likelihood] chance of [failure mode] with [severity] consequences."

Examples:
- ✅ "Cole assesses high likelihood that the vault becomes unusable without dedup, with severe impact on all downstream systems."
- ✅ "Wayne's doctor identifies elevated risk of heart disease — moderate likelihood, high severity."
- ✅ "Analytic tool flags 15% probability of structural failure within 1000 flight hours — catastrophic severity."

---

### goal (short-term)

A short-term goal is a desired future state held by an entity with a mind, with a near time horizon, that is concrete, measurable, and directly actionable.

Three parts:
- **Desired future state** — it describes something that doesn't exist yet but the entity wants to bring about.
- **Concrete and measurable** — you know exactly what success looks like. You can tell when it's achieved.
- **Near time horizon** — days to weeks. It represents work that can be started and completed in the immediate future.

What a short-term goal is NOT:
- Not a decision (a decision is a choice already made — a goal is a state not yet achieved)
- Not a task (a task is a unit of work — a goal is the desired outcome that tasks serve)
- Not a preference (a preference predicts what someone wants in recurring situations — a goal is a specific future state to be achieved once)
- Not a fact (facts describe current reality — goals describe desired future reality)

Quick test: "X wants to achieve Y by [near timeframe], and success is measurable." If the timeframe is months or years, it's a long-term goal. If it can't be measured, it may be an aspiration.

Short-term goals tell the agent **what to work on right now**. They are tactical and operational.

Examples:
- ✅ "Ship Cortex Phase 2 observer pipeline this week."
- ✅ "Get the 1,085 observations deduplicated and quality-audited before moving to implementation."
- ✅ "Complete the pipeline-fixes analysis document by end of today's session."

---

### goal (long-term)

A long-term goal is a desired future state held by an entity with a mind, with a distant but finite time horizon, that is concrete and measurable but requires sustained effort across many short-term goals.

Three parts:
- **Desired future state** — it describes something that doesn't exist yet but the entity is working toward.
- **Concrete and measurable** — you know what success looks like, even if it's far away. You can track progress.
- **Distant but finite time horizon** — months to years. It is achievable, but not in days or weeks. It requires decomposition into short-term goals.

What a long-term goal is NOT:
- Not a short-term goal (if it can be completed in days or weeks, it's short-term)
- Not an aspiration (if it has no clear end state or success criteria, it's an aspiration)
- Not a belief (beliefs are convictions about how things are — goals are about how things should become)
- Not a decision (decisions are commitments already made — goals are states not yet reached)

Quick test: "X wants to achieve Y over [months/years], and progress is trackable." If achievable this week, it's short-term. If there's no clear finish line, it's an aspiration.

Long-term goals tell the agent **how to prioritize**. When short-term goals compete for attention, the one that serves the long-term goal wins.

Examples:
- ✅ "Build Sigma School into a platform serving thousands of students."
- ✅ "Save $2.6 million for retirement."
- ✅ "Make Cortex the standard memory infrastructure for OpenClaw agents."

---

### aspiration

An aspiration is a desired future state held by an entity with a mind that defines direction and identity rather than a measurable destination. Aspirations are strategic — they may never be fully "achieved," but they guide every decision along the way.

Three parts:
- **Directional, not terminal** — it points toward a way of being, not a finish line. You don't arrive; you move closer.
- **Identity-shaping** — it reflects who the entity wants to be or what they want the world to look like. It shapes values, priorities, and long-term goals.
- **Persistent** — aspirations rarely change. They are the most stable type of goal. When they do change, it represents a fundamental shift in direction.

What an aspiration is NOT:
- Not a long-term goal (long-term goals are measurable and achievable — aspirations are directional and ongoing)
- Not a belief (beliefs are about how things are — aspirations are about how things should become)
- Not a preference (preferences predict recurring wants — aspirations define overarching direction)

Quick test: "X aspires to Y" — where Y is a direction or vision, not a measurable end state. If you can clearly define "done," it's a goal, not an aspiration.

Aspirations tell the agent **how to evaluate**. When making judgment calls with no clear answer, the aspiration is the tiebreaker. Aspirations are the north star.

Examples:
- ✅ "Wayne aspires to transform how children learn through technology."
- ✅ "Working with AI should feel like working with a real person."
- ✅ "Build AI systems that compound intelligence over time, not just respond to prompts."

---

---

## Operational Observation Types

### Why constraints are operational, not cognitive

Constraints are practical boundaries that restrict action. They can originate from:
- **Reality** — physical laws, resource limitations, time ("The API rate limit is 1 req/sec")
- **Legal/social systems** — laws, regulations, platform rules ("A 10-year-old cannot legally drive")
- **Decisions** — choices that create boundaries ("We chose local-first → can't use cloud for core functionality")
- **People** — imposed limits ("API costs must stay under $500/month")

What looks like a "cognitive constraint" is either a **practical constraint** (a real limitation of cognitive capacity — which is a fact) or a **belief** (a conviction about one's own limitations that may or may not be accurate). "I can't learn calculus because I'm not smart enough" is a belief, not a constraint. Remove the belief and the constraint disappears. "I can't focus for more than 20 minutes due to ADHD" is a practical constraint — a real property of the mind.

Constraints are about the world, not about minds. Though minds recognize and respond to them, constraints don't require a mind to hold them. This makes them operational, not cognitive.

### constraint

A constraint is a practical boundary that restricts what actions are possible or permissible.

Three parts:
- **Restrictive** — it limits what can be done. It says "you cannot" or "you must." It has a prescriptive force that facts, opinions, and other cognitive types lack.
- **Practical** — it is grounded in reality: physical, legal, financial, technical, or temporal. It is not a belief or a preference — it is an actual boundary.
- **Actionable** — knowing the constraint directly shapes planning and execution. You must work around it or within it.

What a constraint is NOT:
- Not a belief (beliefs are convictions that may or may not reflect real limitations — constraints are actual boundaries)
- Not a preference (preferences are about what's wanted — constraints are about what's possible)
- Not a fact (facts describe state — constraints restrict action. "The API allows 1 req/sec" is a fact. "We cannot exceed 1 req/sec" is the constraint that follows from it.)

Quick test: "We cannot do X because of Y" or "We must do X because of Y" — where Y is a real, practical limitation.

Examples:
- ✅ "The Brave Search API is rate-limited to 1 request per second on the Free plan."
- ✅ "The context window is 1M tokens — all session content must fit within this limit."
- ✅ "API costs must stay under $500/month." (imposed by Wayne — originated from a decision, now functions as a constraint)
- ✅ "The system must work offline — no cloud dependencies for core functionality." (originated from a decision to be local-first)

---

### project

A project is an organization of ideas, work, and resources in the pursuit of a defined set of goals.

Three parts:
- **Organization** — it is an intentional arrangement, not a random collection. Ideas, work, and resources are structured in relation to each other.
- **Ideas, work, and resources** — a project encompasses the thinking (facts, opinions, decisions), the doing (tasks, milestones), and the means (time, money, people, tools).
- **Pursuit of defined goals** — a project exists to achieve specific goals. Without goals, it's just a collection. The goals give the project direction and a basis for evaluating progress.

What a project is NOT:
- Not a goal (goals are desired future states — a project is the organization of work to reach them)
- Not a task (a task is a single unit of work — a project organizes many tasks)
- Not a decision (a decision is a choice — though a decision may create a project)
- Not a fact (a fact describes reality — a project is a structure created to change reality)

Quick test: "X is an organized effort involving ideas, work, and resources toward defined goals." If it's just a single task or a single goal, it's not a project.

Examples:
- ✅ "Cortex — building persistent memory infrastructure for OpenClaw agents."
- ✅ "Hydrilla — persuading the city of Austin to properly treat hydrilla in Lake Austin."
- ✅ "SigmaRead — building an AI-powered reading comprehension tool for students."

---

### milestone

A milestone is a significant marker of progress, declared by an intelligent entity.

Three parts:
- **Significant** — it marks a meaningful threshold, not just any change. An intelligent entity has judged this moment as noteworthy. Not every state change is a milestone.
- **Marker of progress** — it denotes that meaningful advancement has occurred. Progress can be through time, toward a goal, through a system, through a process — any dimension where forward movement is possible.
- **Declared by an intelligent entity** — milestones don't exist in nature. They are meaning assigned to moments by intelligent entities. Water freezing is a state change. A child turning 21 is a milestone because an intelligent entity decided it matters.

Milestones commonly exist within projects — nearly every project has a set of milestones marking progress toward its goals. But milestones can also exist outside of projects, marking significant moments in life or any context an intelligent entity deems important.

Milestones have status:
- **Future** — defined but not yet reached
- **Achieved** — reached and completed
- **Failed/incomplete** — the moment passed without achievement

What a milestone is NOT:
- Not a goal (goals are desired future states — a milestone marks that progress was made)
- Not a task (tasks are work to be done — milestones mark achievement, not activity)
- Not a fact (facts describe current state — milestones assign significance to a moment of change)
- Not a state change (state changes happen regardless of intelligent entities — milestones require one to declare significance)

Quick test: "X marks significant progress." If no intelligent entity would consider it significant, it's just a state change, not a milestone.

Examples:
- ✅ "Cortex Phase 1 shipped — graph builder, observer daemon, and web explorer deployed."
- ✅ "Max turns 21."
- ✅ "Reaching level 60 in World of Warcraft."
- ✅ "Building the 50th floor on a 100-floor skyscraper."
- ❌ "Fixed a typo in the README" — not significant enough to be a milestone.

---

### task

A task is a discrete unit of work that persists beyond the immediate exchange and can be tracked to completion.

Three parts:
- **Discrete unit of work** — it describes a specific action or set of actions to be performed. It is bounded — you can tell when it's done.
- **Persists beyond the immediate exchange** — if a directive is resolved within the same conversation (e.g., "check the weather"), it's not a task. A task requires future effort and tracking.
- **Trackable** — progress can be observed. A task has status along two independent dimensions:
  - **Completeness** — how much of the work is done (a spectrum from not started to fully complete)
  - **Success/failure** — how well the work achieved its purpose (a spectrum from failed to fully successful). These are independent: a task can be fully complete but unsuccessful.

A **directive** ("check the weather", "show me the file") is an instruction that expects immediate resolution. Directives are not tasks — there is nothing to track. The pipeline should generally not extract directives.

What a task is NOT:
- Not a directive (directives are resolved immediately — tasks persist)
- Not a goal (goals are desired future states — tasks are units of work that serve goals)
- Not a commitment (commitments are pledges of intent — tasks are the work itself. A commitment may include a task, but they're distinct)
- Not a milestone (milestones mark significant progress — tasks are the work that produces progress)

Quick test: "This work needs to be done, it won't be done right now, and we need to track it." If it's resolved immediately, it's a directive, not a task.

Examples:
- ✅ "Deduplicate the 1,085 observations in the vault."
- ✅ "Test ClawVault against our transcripts and report results."
- ✅ "Redesign the observation pipeline extraction prompts."
- ❌ "Check the weather." — resolved immediately, directive not task.
- ❌ "Show me that file." — resolved immediately, directive not task.

---

### resource

A resource is something finite that can be used to perform work.

Three parts:
- **Finite** — there is a limited amount or quantity. Even if abundant, it's not infinite.
- **Usable** — it can be applied toward performing work. It has utility. An account enables deployment. A Mac Mini enables computation. Money enables purchasing.
- **Identifiable** — it can be named and tracked. "The Vercel account," "the Mac Mini," "$500/month API budget," "Cole's time."

Resources can be:
- **Physical** — hardware, materials, space
- **Financial** — money, budgets, credits
- **Access** — accounts, API keys, credentials, domain names
- **Compute** — CPU, memory, storage, bandwidth
- **Human** — people's time and attention (though people are entities, their time is a resource)
- **Temporal** — time itself, deadlines

Resources have status:
- **Available** — ready to be used
- **Allocated** — committed to specific work
- **Consumed/depleted** — used up
- **Planned/ordered** — not yet available but expected

What a resource is NOT:
- Not a constraint (constraints restrict action — resources enable it. Though a limited resource creates a constraint.)
- Not a task (tasks are work to be done — resources are what you use to do the work)
- Not a fact (a fact describes state — a resource is something you can use. "We have a Mac Mini" is a fact about a resource.)

Quick test: "X can be used to perform work, and there's a finite amount of it."

Examples:
- ✅ "Wayne's Vercel account under the sigmascore scope."
- ✅ "Mac Mini running the gateway and observer daemon, plus two more on order."
- ✅ "$500/month API budget."
- ✅ "The coleclawson GitHub account."

---

### event

An event is something that has occurred, is occurring, or will occur. It is temporal in nature — it has a beginning and an end, even if those boundaries are unknown.

Three parts:
- **Temporal** — it exists in relationship to time. It has boundaries (beginning, end), even if unknown or approximate. This is what distinguishes an event from a fact. A fact describes state. An event describes an occurrence.
- **Specific** — it describes a particular occurrence, not a permanent state.
- **Any tense** — past, present, or future. An event can be a moment, a duration, or recurring.

What an event is NOT:
- Not a fact (facts describe state without temporal boundaries — "SigmaRead has 10 students")
- Not a milestone (milestones mark significant progress — events are any occurrence, significant or not)
- Not a task (tasks are work to be done — events are things that happen)

Quick test: Does it have temporal boundaries? If it started (or will start) and will end (or has ended), it's an event. If it's an ongoing state with no boundaries, it's a fact.

Examples:
- ✅ "The observer daemon crashed overnight."
- ✅ "Black History Month."
- ✅ "The product launches next month."
- ✅ "The morning batch runs at 5am CT daily."
- ❌ "SigmaRead has 10 students." — state, no temporal boundaries.

---

### dependency

A dependency is where one entity requires another entity.

Three parts:
- **One entity requires another** — each dependency is a single requirement. A requires B. If B also requires A, that's a second, independent dependency. Complexity (mutual dependencies, chains) emerges from composing simple dependencies, not from defining complex types.
- **Requirement** — it's not optional. If the required entity isn't in place, the dependent entity cannot function, proceed, or succeed.
- **Work-oriented** — dependencies are typically about getting work done. They describe sequencing, prerequisites, and blockers.

What a dependency is NOT:
- Not a relationship (relationships describe how entities connect — dependencies describe what requires what)
- Not a constraint (constraints bound how work is done — dependencies determine what must come first)
- Not a task (tasks are work — dependencies describe ordering between work)

Quick test: "X cannot proceed without Y." If removing Y would block X, it's a dependency.

Examples:
- ✅ "Nexus requires Cortex for its knowledge store."
- ✅ "The graph builder requires observations to be in the vault."
- ✅ "The deployment requires tests to pass."
- ❌ "Wayne owns Sigma School." — a relationship, not a requirement.

---

**Relationships** are not an observation type. They are graph-level structure — edges between entities that emerge when observations reference multiple entities. The observation pipeline extracts facts (e.g., "Carolyn is Wayne's wife"). The knowledge graph and consolidation process recognize that this fact implies an entity connection and create/strengthen the appropriate edge. See Open Questions for consolidation process notes.

---

**Terminology note:** Throughout this document, "intelligent entity" refers to any entity capable of cognition — humans, AI agents, or other intelligent systems. This term replaces earlier uses of "mind" or "entity with a mind" to avoid biological connotation that might cause an LLM to scope these concepts exclusively to humans. A full pass to update all prior definitions to use "intelligent entity" is pending.

---

## Open Questions (to address during structured discussion)

0. **Are observation types more than observation types? Are they also node types in the knowledge graph?** The type taxonomy we're building defines what gets *extracted*. But these same types could define what gets *stored* as nodes in the graph — a fact node, a belief node, a decision node, a constraint node. If so, the observation type system isn't just a pipeline classification tool — it's the ontology of the knowledge graph itself.

0. **Relationships are not an observation type — they are graph structure.** The pipeline extracts facts; the graph and consolidation process handle relationship discovery and strengthening. See Q7 in `vault-consolidation-design.md`.

1. Should entity tags have confidence weights for how strongly the observation correlates with the tag?
2. What is the exact definition of confidence vs. importance?
3. How exactly are confidence and importance calculated? (Current: base 0.5/0.3 + signal modifiers. Is this right?)
4. How does Cortex know how to filter for "what changes future behavior"?
5. What criteria predicts "would an agent actually search for this?"
