# Cortex Knowledge Graph — Taxonomy & Ontology

This document defines the complete type taxonomy for the Cortex knowledge graph. It contains:

1. **The knowledge graph split** — The agent's mind vs. the human's computer
2. **The full type taxonomy** — 17 types across 3 categories (concept/entity/relation), each with rigorous first-principles definitions, distinguishing criteria, and examples
3. **Ontology implications** — These observation types are also the node types in the knowledge graph

**Origin:** Built iteratively through dialogue between the maintainers. Started from analysis of early observation data and evolved into first-principles epistemology. The taxonomy defines what Cortex knows and how it's organized.

**How it's used:** The agent applies this taxonomy at write time via the `cortex_observe` skill. When the agent identifies an observation during conversation, it classifies it into one of the 17 types below before writing to `observer/observations.jsonl`. The daemon validates the type against the default taxonomy plus any custom types defined in `observer/taxonomy.yml`. `observation` is a staging state for unclassified input, not a final type — it must resolve to a typed category or be pruned.

**Applies to:** v0.2.0 (agent-as-extractor architecture)

---

## Design Principle: Type-Specific Quality Gates

**Observation from the owner:** Determining whether an observation is important, useful, and worthy of committing to the vault is *specific to the type of observation*. The criteria for a good decision is different from the criteria for a good preference, which is different from a good fact.

**Implication:** The agent should not use a single universal quality gate. Each observation type has its own:
- **Write criteria** — what makes this type worth writing?
- **Quality bar** — what separates a vault-worthy observation from noise?
- **Dedup profile** — how do duplicates manifest for this type?
- **Usefulness test** — how would an agent use this type of observation in a future session?

The agent applies type-specific judgment at write time — it has conversational context to distinguish a strategic decision from an implementation detail. The daemon then applies mechanical scoring adjustments and deduplication.

We define the specific criteria for each type below.

---

## Design Principle: The Knowledge Graph Split

**Observation from the owner:** The knowledge graph should split into two fundamentally different regions, distinguished by audience and purpose:

**(a) The agent's mind** — everything the agent needs to operate. This includes both memories (preferences, beliefs, lessons, interaction patterns) and structured data the agent uses to do work (project architectures, dependency maps, technical context). The agent organizes this however it sees fit. The agent decides what goes in, how it's structured, and what matters — optimized for whatever the agent believes it needs to perform its work effectively. This is not a human-curated knowledge base. It's the agent building its own cognitive infrastructure. Humans never see this directly and don't need to.

Examples: "The owner pushes back on complexity, prefers simplification." "When the owner says 'proceed' they mean stop discussing and execute." "Cortex uses SQLite — relevant for all technical decisions." "The pipeline has 18 observation types organized into cognitive and operational groups."

**(b) The human's computer** — well-organized information that humans can search, browse, and use. Think of it like a file system, a wiki, a project tracker. Project descriptions, architecture documents, research reports, task lists, contacts. Organized in familiar hierarchies that humans expect — files and folders, categories and tags. The organizing principle is: what does the human need to find and use?

Examples: ExampleApp renders a task list for the owner to review. Explorer shows the knowledge graph for humans to browse. A project spec is formatted for human reading.

**The key distinction:** The split is by **audience and purpose**, not by data type. The agent's mind is organized *by the agent, for the agent* — whatever the agent needs to do its job. The human's computer is organized for human consumption — browsable, navigable, structured in ways humans expect.

The same information can live in both. "Cortex uses SQLite" might be in the agent's mind (for making technical decisions) and in the human's computer (in a project architecture doc the owner can review). The agent's mind is a superset in some ways — it contains things humans would never care about ("The owner gets frustrated when I over-explain") alongside things humans do care about (project specs).

**How observation types route into this:**

- **Memories and agent-facing knowledge** are retrieved *implicitly* — loaded at session start, used to shape tone, approach, and decision-making. The agent doesn't search for "does the owner like bullet points?" — it just *knows*. The format optimizes for LLM absorption. The quality bar is "does this make me a better agent?"

- **Human-facing knowledge** is retrieved *explicitly* — searched when doing work, queried by tools, rendered for humans through familiar interfaces. The format needs to be human-readable. The quality bar is "is this accurate, current, and organized so a human can find it?"

The 17 observation types serve as a routing guide. Concept types (fact, opinion, belief, preference, lesson, decision, commitment, goal_short, goal_long, aspiration, constraint) route predominantly to the **agent's mind** — they shape how the agent thinks and operates. Entity types (milestone, task, resource, event) and Relation types (project, dependency) often appear in **both** — the agent needs them for work, and humans need visibility into them.

**Key insight:** A single observation can produce both. "We chose Postgres over MongoDB because the owner values simplicity and local-first" contains agent knowledge (the owner values simplicity — shapes future decisions) and human-facing knowledge (the project uses Postgres — belongs in the architecture doc). One extraction, two destinations.

**Where this fits in the pipeline:** After extraction and type classification, observations are *routed* based on audience and purpose. The type classification informs routing but doesn't determine it rigidly — context matters. This is a routing/destination concern, not a type classification concern.

**Open question:** Whether this needs two physically separate stores vs. two logical views of one store is an implementation question. The conceptual split is sound from first principles — it mirrors how human cognition works. What you know implicitly (how to interact with the world) and what you keep in organized files (documents, notes, references) serve different purposes and are accessed differently.

---

## Observation Type Definitions (Agent Prompt Format)

Observation types are organized into three categories:

**Concept (12 types)** — ideas the agent holds. These are products of intelligent entities and describe how they model reality, form judgments, hold convictions, want things, learn from experience, commit to choices, and direct toward future states. Types: fact, opinion, belief, preference, lesson, decision, commitment, goal_short, goal_long, aspiration, constraint.

**Entity (4 types)** — things in the world. These are concrete objects, resources, and occurrences that can be tracked and managed. Types: milestone, task, event, resource.

**Relation (2 types)** — connections between things. These describe how entities relate to and depend on each other. Types: project, dependency.

**Staging state:** `observation` is not a final type — it is a lifecycle staging state for unclassified input. Observations in this state must resolve to one of the 17 typed categories or be pruned. Analogous to a sensory buffer in neuroscience.

Each type follows the same structure: definition, three parts, what it's NOT, quick test, examples.

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
- ✅ "ExampleApp has 10 active students across 5 reading levels."
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
- ✅ "The owner judged the earlier Compass repo as low-quality, based on reviewing the output."
- ✅ "The maintainers concluded the pipeline extracts too much and curates too little, based on auditing 1,085 observations."

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
- ✅ "The owner believes the moat is data and iteration, not software."
- ✅ "The owner believes working with AI should feel like working with a real person."
- ✅ "The owner believes education should be designed for how students learn, not how classrooms operate."

---

### preference

A preference is a property of an intelligent entity that is useful for predicting that entity's behavior. A preference implies a choice — the entity wants A over B.

Three parts:
- **Intelligent entity** — preferences belong to humans, AI agents, or any intelligent entity with wants. No intelligence, no preference.
- **Useful for prediction** — the preference is valuable because it enables predicting what the entity will want in future situations.
- **Implies a choice** — the entity wants A over B. If it cannot be phrased as "X prefers A over B," it is not a preference.

What a preference is NOT:
- Not a fact (facts describe state without implying a want)
- Not a lesson (lessons are about the world, not about an entity's wants)
- Not a belief (beliefs are convictions about what's true — preferences are about what's wanted)
- Not observed behavior without a want (if someone does X but doesn't want X, that's a fact, not a preference)

Quick test: "X prefers A over B." If it can't be phrased that way, it's not a preference.

Examples:
- ✅ "The owner prefers honest feedback over softened answers."
- ✅ "The owner prefers implement-test-refine over perfect upfront design."
- ✅ "The owner prefers simplification over adding features from competitive analysis."

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
- ✅ "We split the system into ExampleApp (coordination) and Cortex (memory) instead of building a monolith."
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

### goal (short-term)

A short-term goal is a desired future state held by an intelligent entity, with a near time horizon, that is concrete, measurable, and directly actionable.

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

A long-term goal is a desired future state held by an intelligent entity, with a distant but finite time horizon, that is concrete and measurable but requires sustained effort across many short-term goals.

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
- ✅ "Build ExampleOrg into a platform serving thousands of students."
- ✅ "Save $2.6 million for retirement."
- ✅ "Make Cortex the standard memory infrastructure for OpenClaw agents."

---

### aspiration

An aspiration is a desired future state held by an intelligent entity that defines direction and identity rather than a measurable destination. Aspirations are strategic — they may never be fully "achieved," but they guide every decision along the way.

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
- ✅ "The owner aspires to transform how children learn through technology."
- ✅ "Working with AI should feel like working with a real person."
- ✅ "Build AI systems that compound intelligence over time, not just respond to prompts."

---

---

## Concept Types (continued)

### Why constraints are concepts, not entities

Constraints are ideas the agent holds about boundaries that restrict action. They can originate from:
- **Reality** — physical laws, resource limitations, time ("The API rate limit is 1 req/sec")
- **Legal/social systems** — laws, regulations, platform rules ("A 10-year-old cannot legally drive")
- **Decisions** — choices that create boundaries ("We chose local-first → can't use cloud for core functionality")
- **People** — imposed limits ("API costs must stay under $500/month")

What looks like a "self-imposed constraint" is either a **practical constraint** (a real limitation — which is a fact) or a **belief** (a conviction about one's own limitations that may or may not be accurate). "I can't learn calculus because I'm not smart enough" is a belief, not a constraint. Remove the belief and the constraint disappears. "I can't focus for more than 20 minutes due to ADHD" is a practical constraint — a real property that must be worked within.

Constraints are ideas the agent holds about boundaries — they shape how the agent plans and acts. This makes them concepts, part of how the agent models the world.

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
- ✅ "API costs must stay under $500/month." (imposed by the owner — originated from a decision, now functions as a constraint)
- ✅ "The system must work offline — no cloud dependencies for core functionality." (originated from a decision to be local-first)

---

## Relation Types

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
- ✅ "ExampleApp — building an AI-powered reading comprehension tool for students."

---

## Entity Types

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
- ✅ "Person B turns 21."
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
- ✅ "The owner's Vercel account under the example-org scope."
- ✅ "Mac Mini running the gateway and observer daemon, plus two more on order."
- ✅ "$500/month API budget."
- ✅ "The example-user GitHub account."

---

### event

An event is something that has occurred, is occurring, or will occur. It is temporal in nature — it has a beginning and an end, even if those boundaries are unknown.

Three parts:
- **Temporal** — it exists in relationship to time. It has boundaries (beginning, end), even if unknown or approximate. This is what distinguishes an event from a fact. A fact describes state. An event describes an occurrence.
- **Specific** — it describes a particular occurrence, not a permanent state.
- **Any tense** — past, present, or future. An event can be a moment, a duration, or recurring.

What an event is NOT:
- Not a fact (facts describe state without temporal boundaries — "ExampleApp has 10 students")
- Not a milestone (milestones mark significant progress — events are any occurrence, significant or not)
- Not a task (tasks are work to be done — events are things that happen)

Quick test: Does it have temporal boundaries? If it started (or will start) and will end (or has ended), it's an event. If it's an ongoing state with no boundaries, it's a fact.

Examples:
- ✅ "The observer daemon crashed overnight."
- ✅ "Black History Month."
- ✅ "The product launches next month."
- ✅ "The morning batch runs at 5am CT daily."
- ❌ "ExampleApp has 10 students." — state, no temporal boundaries.

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
- ✅ "ExampleApp requires Cortex for its knowledge store."
- ✅ "The graph builder requires observations to be in the vault."
- ✅ "The deployment requires tests to pass."
- ❌ "The owner owns ExampleOrg." — a relationship, not a requirement.

---

**Relationships** are not an observation type. They are graph-level structure — edges between entities that emerge when observations reference multiple entities. The observation pipeline extracts facts (e.g., "Person A is related to the owner"). The knowledge graph and consolidation process recognize that this fact implies an entity connection and create/strengthen the appropriate edge. See Open Questions for consolidation process notes.

---

**Suggestions** are not an observation type. Suggestions are speech acts — ways of using language to accomplish something. When someone suggests "we should use Postgres," they are performing an action (proposing) that may lead to a decision. The suggestion itself is not worth capturing. What matters is what the suggestion produces:

- If the suggestion leads to a decision ("Yes, we'll use Postgres"), extract the **decision**
- If the suggestion is rejected or ignored, there's nothing to extract
- If the suggestion surfaces a consideration worth tracking ("We should consider X"), it might produce a **task** ("Evaluate X") or a **risk** ("Not considering X could cause Y")

Suggestions don't represent a distinct type structure — they represent *how* typed structures (decisions, tasks, risks) come into being through conversation.

---

**People** are not an observation type. People are **entities** — nodes in the knowledge graph, not observations about nodes. The observation pipeline extracts facts, preferences, beliefs, and other observation types *about* people. Those observations reference people as entities. The knowledge graph maintains the entity records (the owner, Cole the AI agent, etc.) and connects them to observations through entity tagging.

Example: "The owner prefers honest feedback over softened answers" is an observation of type **preference** that references the entity **owner**. The owner themselves is not an observation — they are the entity the observation is about.

This distinction matters for the pipeline: the extractor identifies observation types and tags them with entity references. The graph builder maintains the entity nodes and connects observations to them.

---

**Terminology note:** Throughout this document, "intelligent entity" refers to any entity capable of cognition — humans, AI agents, or other intelligent systems. This term replaces earlier uses of "mind" or "entity with a mind" to avoid biological connotation that might cause an LLM to scope these concepts exclusively to humans. All definitions have been updated to use "intelligent entity" consistently.

---

## Open Questions (to address during structured discussion)

0. ~~**Are observation types more than observation types? Are they also node types in the knowledge graph?**~~ **RESOLVED: Yes.** The 17 observation types are both pipeline classification labels and knowledge graph node types. The taxonomy is the ontology. (`observation` is a staging state, not a type.)

0. **Relationships are not an observation type — they are graph structure.** The pipeline extracts facts; the graph and consolidation process handle relationship discovery and strengthening. See Q7 in `vault-consolidation-design.md`.

1. Should entity tags have confidence weights for how strongly the observation correlates with the tag?
2. What is the exact definition of confidence vs. importance?
3. How exactly are confidence and importance calculated? (Resolved: bucket-based defaults — explicit c=0.9/i=0.5, ambient c=0.7/i=0.5. Calibration rules can adjust. See observer.md.)
4. How does Cortex know how to filter for "what changes future behavior"?
5. What criteria predicts "would an agent actually search for this?"
