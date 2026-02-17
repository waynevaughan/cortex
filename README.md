# Cortex

A brain for your AI agent.

Cortex gives AI agents persistent memory — knowledge that survives across sessions, agents, and time. Without it, every conversation starts from zero. With it, your agent actually learns.

## The Four Parts

| Part | What it does |
|---|---|
| **Buffer** | Working memory. Manages the context window, session handoff, and wrap procedures so agents don't lose track of what they're doing. |
| **Mind** | Concepts that influence how agents operate — preferences, beliefs, lessons, decisions, goals. Cortex-owned. Decays over time unless reinforced. |
| **Vault** | Application storage. Whatever the application needs to store — documents, people, projects, facts, scratch data. Application-owned. No decay. |
| **Index** | Search across Mind and Vault. |

## How It Works

Agents observe knowledge during conversations. Observations flow through a processing queue to a daemon that validates, deduplicates, and routes entries to the Mind or Vault. The daemon is dumb — zero LLM calls. The agent does all the thinking.

Everything is stored as markdown files with frontmatter in a local git repository. No databases, no cloud dependencies, no proprietary formats.

## What's in This Repo

**`spec/`** — Design specifications. Start with [`architecture.md`](spec/architecture.md) for the big picture, then [`storage.md`](spec/storage.md) for how data is stored.

**`vault/`** — Working implementation. Scripts, git hooks, and conventions for managing a Cortex knowledge store.

**`docs/`** — Guides and reference material.

## Design Principles

- **Markdown is the source of truth.** Plain files in a git repo.
- **The agent extracts knowledge in real-time** — not at session end when memory is degraded.
- **The daemon is dumb.** Zero LLM calls. It validates, deduplicates, routes, and commits.
- **Simple first.** Start with the simplest working solution.
- **Local-first.** Everything runs on the developer's machine.
- **Cortex is infrastructure, not an application.** It doesn't know about your domain. It provides memory primitives that any application can build on.

## Status

Under active development. The Vault and Buffer layers are operational and in daily use. Mind and Index are being specified.

## License

MIT
