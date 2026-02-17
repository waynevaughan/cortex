---
id: 019c6a09-91fe-77a6-9cb3-ab132c78b2ac
type: document
category: entity
created: 2026-02-14
source_hash: e5c8d5f7956d9aff7cd36b55dc451bf100255718730b5a2ddcd936716190d584
relates_to: []
---



















# Cortex Vault

A knowledge management system for AI agents and their humans. Markdown documents with structured YAML frontmatter, validated by git hooks, indexed automatically.

Cortex Vault stores institutional knowledge — decisions with rationale, architecture specs, research findings, and conventions. It's long-term memory that survives across sessions, agents, and time.

## How It Works

- **Documents** are Markdown files with YAML frontmatter (id, title, tags, hash, etc.)
- **Pre-commit hook** auto-generates UUIDv7 IDs, computes content hashes, and validates tag schemas
- **Promote script** imports external documents into the vault with proper frontmatter
- **Reindex script** regenerates a table-of-contents INDEX.md
- **Git** is the storage layer — every change is versioned

Works great with [OpenClaw](https://github.com/openclaw) AI agents, but has no dependencies on it. Any git-based workflow works.

## Quick Start

```bash
# Clone and init a new vault
git clone https://github.com/your-org/cortex-vault.git my-vault
cd my-vault
bash bin/init.sh .

# Edit .cortexrc with your username
# Commit — the pre-commit hook handles the rest
git add my-doc.md
git commit -m "add: my first document"
```

### Init a vault from scratch

```bash
bash bin/init.sh ~/my-vault
cd ~/my-vault
```

This creates the directory structure, installs git hooks, and copies templates.

## Document Format

Every document requires YAML frontmatter:

```yaml
---
id: ""              # Auto-generated UUIDv7 (leave empty, hook fills it)
hash: ""            # Auto-computed SHA-256 of body (leave empty)
title: "My Decision"
description: "Why we chose X over Y"
author: username
date: 2026-01-15
tags: [type/decision, status/draft, topic/architecture]
---

Your markdown content here.
```

### Tags

Tags use `namespace/value` format, all lowercase.

| Namespace | Required | Values |
|-----------|----------|--------|
| `type/` | Yes | `decision`, `spec`, `research`, `guide`, `convention`, `retrospective` |
| `status/` | Yes | `draft`, `active`, `superseded` |
| `topic/` | No | Any value (e.g., `topic/architecture`) |
| `project/` | No | Any value (e.g., `project/myapp`) |

### Document Lifecycle

**draft** → **active** → **superseded**

When superseding a document, add a `superseded-by` field with the replacement's `id` and `path`.

## Promote Workflow

Import an external document into the vault:

```bash
node bin/promote.mjs ~/workspace/research.md --type research --status draft --tags topic/ai
```

The script:
1. Extracts title and description from the source
2. Generates frontmatter with your configured author name
3. Checks for duplicates
4. Writes to the vault, commits, and pushes

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `bin/promote.mjs` | Import external documents into the vault with frontmatter |
| `bin/reindex.sh` | Regenerate INDEX.md from all document frontmatter |
| `bin/init.sh` | Scaffold a new vault (idempotent) |

## Pre-Commit Hook

The `.githooks/pre-commit` hook runs automatically on every commit:

- **UUIDv7 generation** — assigns a unique, chronologically sortable ID to new documents
- **SHA-256 hashing** — computes a content hash of the document body (frontmatter changes don't affect it)
- **Tag validation** — enforces namespace rules, required tags, and valid values
- **Auto-fix** — normalizes tag casing and whitespace, re-stages modified files

Install with: `git config core.hooksPath .githooks`

## Configuration

Create a `.cortexrc` file (JSON) in the vault root or home directory:

```json
{
  "vaultPath": ".",
  "user": "your-username",
  "defaultStatus": "draft"
}
```

Environment variables override config: `CORTEX_VAULT_PATH`, `CORTEX_USER`.

## License

MIT
