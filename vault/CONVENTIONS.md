---
title: Conventions
author: cole
created: 2026-02-14
status: active
tags: [type/guide, status/active, topic/architecture, project/cortex]
---

# Conventions

Rules for writing and maintaining Vault documents.

## Frontmatter Schema

Every `.md` document (except README.md and CONVENTIONS.md) must include YAML frontmatter:

| Field | Required | Description |
|---|---|---|
| `id` | Yes (auto-generated) | UUIDv7 — unique, chronologically sortable, never changes |
| `hash` | Yes (auto-computed) | SHA-256 of normalized body — maintained by pre-commit hook |
| `title` | Yes | Short descriptive title |
| `description` | Yes | One-line summary |
| `author` | Yes | Who wrote it (e.g., your username) |
| `date` | Yes | Creation date (`YYYY-MM-DD`) |
| `tags` | Yes | Array of `namespace/value` tags |
| `superseded-by` | Only when superseded | Object with `id` and `path` of replacement |

## Tags

Tags use `namespace/value` format. All values are lowercase.

### Closed Namespaces (fixed values)

**`type/`** (required — exactly one per document):
- `decision` — A decision with rationale
- `spec` — Technical specification
- `research` — Research findings or analysis
- `guide` — How-to or instructional content
- `convention` — Standards and rules
- `review` — Code review, spec critique, audit, or security review
- `retrospective` — Post-mortem or lessons learned
- `observation` — Auto-extracted insight from session transcripts

**`status/`** (required — exactly one per document):
- `draft` — Work in progress, may change
- `active` — Current and authoritative
- `archived` — No longer current, kept for reference
- `superseded` — Replaced by a newer document

### Open Namespaces (any value)

- **`topic/`** — Subject classification. Multiple allowed. Common values:
  - `topic/architecture`, `topic/context-management`, `topic/code-quality`
  - `topic/observer`, `topic/schema`, `topic/integration`, `topic/memory`
- **`project/`** — Project association. Multiple allowed:
  - `project/cortex`, `project/nexus`, `project/openclaw`

### Rule: All Tags Must Be Namespaced

No bare tags like `cortex`, `planning`, or `observer`. Every tag must use `namespace/value` format.

## Hash Computation

The pre-commit hook handles this automatically. For reference:

1. Extract body (everything after the closing `---` of frontmatter)
2. Normalize: strip leading/trailing blank lines, convert line endings to LF, no trailing newline
3. Compute SHA-256 of the UTF-8 bytes
4. Store as lowercase hex (64 characters)

Frontmatter changes don't affect the hash. Only body changes do.

## Document Lifecycle

**draft → active → superseded**

- **draft**: Living document, edit freely
- **active**: Current and authoritative. Prefer adding a new document over modifying, or update and note what changed.
- **superseded**: Replaced. Add `superseded-by` with the replacement's `id` and `path`.

## Writing Standards

- Start with a Context section: why does this document exist?
- Use headers for scannability
- Keep paragraphs short
- Be self-contained — a reader shouldn't need three other documents to understand this one
- Use tables for comparisons, code blocks for configuration

## File Naming

- Kebab-case: `context-window-research.md`
- Descriptive: `auth-architecture.md` over `auth.md`
- Prefix decisions: `decision-database-selection.md`

## Links

Use standard markdown links with relative paths:

```markdown
See [Database Selection](decisions/decision-database-selection.md) for rationale.
```

No wiki links (`[[double brackets]]`) — standard markdown is portable across all viewers.

## Promotion

Knowledge enters Vault through deliberate promotion from Cache.

**Write gate:** "Would this change how an agent acts in the future?" If no, don't promote.

**Refinement test:**
1. Would a new agent or team member benefit from reading this?
2. Is it self-contained?
3. Is the rationale clear — not just what, but why?

All three must be yes.

Before promoting, search Vault for existing documents on the topic. Update rather than duplicate.
