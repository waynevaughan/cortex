# Contributing to Cortex

This document describes the development process for Cortex.

## Development Philosophy

- **Plan before build** — No implementation without reviewed specs, implementation plan, and test plan
- **Simple is better** — Start with the simplest working solution
- **Design for scale** — Evaluate architecture against thousands of documents and hundreds of entities
- **Test and verify** — If you set it up, confirm it actually works

## Version Numbers

Cortex uses [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

- **MAJOR** — Breaking changes to the vault schema, API, or pipeline architecture
- **MINOR** — New features, new observation types, significant enhancements
- **PATCH** — Bug fixes, performance improvements, documentation updates

Version history:
- **v0.1.0** — Phase 1: Initial vault, pipeline v1, observation extraction

## Branching Strategy

- **`main`** — Production-ready code. All code in main should be stable and tested.
- **Feature branches** — All development happens in feature branches:
  - `feature/description` for new features
  - `fix/description` for bug fixes
  - `docs/description` for documentation updates

### Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout main
   git pull
   git checkout -b feature/your-feature-name
   ```

2. Make your changes with clean, focused commits

3. Push your branch and open a Pull Request:
   ```bash
   git push -u origin feature/your-feature-name
   ```

4. PR is reviewed (by the owner for architecture decisions, autonomously for implementation details)

5. After approval, merge to `main` (squash or merge commit depending on change size)

6. Delete the feature branch after merging

## Commit Messages

Write clear, descriptive commit messages in present tense:

- ✅ "Add real-time observation flagging"
- ✅ "Fix deduplication logic for belief nodes"
- ✅ "Update taxonomy with intelligent entity terminology"
- ❌ "Added stuff"
- ❌ "WIP"
- ❌ "Fixed bug"

For multi-line commits:
```
Short summary (50 chars or less)

More detailed explanation if needed. Wrap at 72 characters.
Explain what and why, not how.
```

## Pull Request Process

1. Open a PR with:
   - **Summary** — What does this PR do?
   - **Changes** — What changed?
   - **Testing** — How was it tested?
   - **Related Docs** — Links to specs, issues, or design documents

2. PRs should be focused — one feature or fix per PR

3. All tests must pass before merging

4. Cole handles 99% of PRs autonomously; the owner reviews architectural changes

## Testing

Every change should include appropriate tests:

- **Unit tests** — For functions and modules
- **Integration tests** — For pipeline components working together
- **Regression tests** — Ensure existing functionality still works

See `docs/test-plan.md` for the full testing strategy.

## Documentation

- Update documentation as you code, not after
- Technical specs go in `docs/`
- User-facing documentation goes in `README.md`
- Architecture decisions are documented in design documents (see `cortex-site/` in the workspace)

## Local Development

```bash
# Run tests
npm test

# Run the observer daemon (development mode)
node observer-daemon.js --dev

# Check vault integrity
node scripts/check-vault.js
```

## Questions?

This project is developed by the maintainers. For questions about the development process, see the workspace documentation.
