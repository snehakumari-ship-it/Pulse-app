# nihas V1.0.20 — CI: stop the Jest job from hanging

## What
- `.github/workflows/architecture-check.yml`, `unit-tests` job: added `timeout-minutes: 15` and `--forceExit` to the Jest command (`npm test -- --ci --passWithNoTests --forceExit`).

## Why
- All 434 test files finish in ~8 minutes on CI, but Jest then stays alive on open handles/timers ("Jest did not exit one second after the test run has completed"). With no job timeout, the job ran on toward GitHub's 6-hour default.
- `--forceExit` ends the process once results are reported; the 15-minute cap stops any future hang (npm ci ~1 min + Jest ~8 min ≈ 9–10 min today).

## Areas
- CI only. No app code, no tests, no required-check settings changed. The 5 known failing suites are untouched.

## Migrations
- None.

## Tested
- Workflow YAML parses; `unit-tests` job reads `timeout-minutes: 15` and the new command.
- Ran the exact CI command locally (`NODE_OPTIONS=--max-old-space-size=4096 npm test -- --ci --passWithNoTests --forceExit`): process exits on its own ("Force exiting Jest"), 434 suites, only the 5 known failures, exit code 1 as before.
