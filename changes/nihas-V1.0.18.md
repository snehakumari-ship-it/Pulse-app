# nihas V1.0.18 — team workflow rules

## What
- Shared team Git workflow + AI trigger words in `.cursor/rules/team-git-workflow.mdc`, imported by CLAUDE.md (Claude + Cursor use one source).
- CI (`architecture-check.yml`) now runs on every PR (path filter removed).
- Removed stale `.cursor/rules/nihas-develop-sync.mdc` (old `develop` flow).

## Why
- Every change should reach V1 through a CI-checked PR; migration/docs-only PRs must not hang on required checks once branch protection is on.

## Areas
- `.cursor/rules/`, `CLAUDE.md`, `.github/workflows/`

## Migrations
- None

## Tested
- Not runtime code; workflow YAML reviewed by hand.
