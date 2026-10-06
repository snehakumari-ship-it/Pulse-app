# nihas V1.0.18 — team workflow rules

## What
- Shared team Git workflow + AI trigger words in `.cursor/rules/team-git-workflow.mdc`, imported by CLAUDE.md (Claude + Cursor use one source).
- CI (`architecture-check.yml`) now runs on every PR (path filter removed).
- Removed stale `.cursor/rules/nihas-develop-sync.mdc` (old `develop` flow).
- Restored `npm test` (script was missing, so the Jest CI job never ran tests).
- No-regression CI gate: `scripts/ci-baseline.js` + `.github/ci-baseline.json` (lint 104, typecheck 97 (CI count; local Node 24 setup reports 140), cycles 111, lib-files 178). Counts may only go down; cleanup PRs lower the baseline.

## Why
- Every change should reach V1 through a CI-checked PR; migration/docs-only PRs must not hang on required checks once branch protection is on.

## Areas
- `.cursor/rules/`, `CLAUDE.md`, `.github/`, `scripts/ci-baseline.js`, `package.json`

## Migrations
- None

## Tested
- Not runtime code. Baselines measured locally with scripts/ci-baseline.js on this branch; CI run confirms.
