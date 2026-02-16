# Cortex

A brain for your AI agent.

Cortex gives [OpenClaw](https://openclaw.ai) agents persistent memory — knowledge that survives across sessions, agents, and time. Without it, every conversation starts from zero. With it, your agent actually learns.

## How It Works

Cortex organizes memory into four layers, each solving a different problem:

| Layer | What it does | Analogy |
|---|---|---|
| **Buffer** | Manages what's in the context window right now | RAM |
| **Cache** | Stores session logs, notes, and working files | Local disk |
| **Vault** | Holds permanent shared knowledge — decisions, specs, research | Network drive |
| **Index** | Searches across everything | Search engine |

Your agent reads from all four layers. Knowledge flows upward: observations from sessions (Buffer) get saved to notes (Cache), and the best insights get memorized to permanent docs (Vault) where any agent can access them.

## What's in This Repo

**`spec/`** — The design specification for each layer. Start here if you want to understand the architecture.

**`vault/`** — The working implementation. Scripts, git hooks, and conventions for managing a Cortex knowledge store. See [`vault/README.md`](vault/README.md) to get started.

## Quick Start

```bash
# Initialize a new vault
git clone https://github.com/openclaw/cortex.git
cd cortex/vault
bash bin/init.sh .

# Write your first knowledge doc, commit it
# The pre-commit hook handles IDs, hashes, and validation
git add my-doc.md && git commit -m "add: first doc"
```

## Status

Cortex is under active development. The Vault layer is operational and in daily use. Buffer and Cache are managed through OpenClaw's built-in memory system. Index is partially implemented via [QMD](https://github.com/nicholasgasior/qmd) hybrid search.

## License

MIT
