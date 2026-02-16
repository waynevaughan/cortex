# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-15

### Added
- Initial vault implementation with observations, private planning, research, and reviews directories
- Observer pipeline v1 with 7-stage extraction process (session → extraction → parsing → validation → dedup → staging → promotion)
- Basic deduplication using content hashing
- Complete 18-type observation taxonomy covering entity definitions, interactions, decisions, process observations, technical facts, and context
- Comprehensive documentation:
  - `docs/cortex-taxonomy.md` — Complete type taxonomy with examples
  - `docs/pipeline-analysis.md` — First pipeline run analysis (1,085 observations from 66 sessions)
  - `spec/` directory with 6 specification documents (buffer, cache, index, observer, session-management, vault)
- Development process documentation:
  - `CONTRIBUTING.md` — Development philosophy, semver, branching strategy, commit guidelines, PR process
  - `.github/pull_request_template.md` — PR template
- Vault conventions and entity profile system

### Technical Details
- Observer daemon runs continuously, monitoring OpenClaw session transcripts
- Observations stored as YAML files with metadata (type, entities, confidence, timestamp)
- Vault conventions defined for consistent formatting and metadata
- Entity detection and profile management system

[0.1.0]: https://github.com/coleturner/cortex/releases/tag/v0.1.0
