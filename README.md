# Cortex

A knowledge management system for AI agents. Persistent memory that survives across sessions, agents, and time.

## Architecture

Cortex organizes agent memory into four layers:

| Layer | Name | Scope | Persistence | Analogy |
|---|---|---|---|---|
| Working memory | **Buffer** | Single agent, single session | Ephemeral | RAM |
| Local storage | **Cache** | Single agent, across sessions | Persistent, private | Local hard drive |
| Shared storage | **Vault** | All agents + users | Permanent, shared | Network drive |
| Search | **Index** | Across Cache + Vault | N/A | Search engine |

## Specification

The design spec lives in `spec/`:

- `spec/buffer.md` — Context window management, session lifecycle, thresholds
- `spec/cache.md` — Local storage, file roles, maintenance, safety rules
- `spec/vault.md` — Shared knowledge, conventions, promotion flow, access model
- `spec/index.md` — Search, QMD, weighting, structural indexes

## Vault

The `vault/` directory contains the working implementation — scripts, hooks, and conventions for managing a Cortex knowledge store.

See [`vault/README.md`](vault/README.md) for setup and usage.

## License

MIT
