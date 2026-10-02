Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R0: Establish the current baseline

What to do:

1. Identify bundle version, loaded backend version, repository commit, active database path, and possible reuse of an existing server.
2. Reproduce F01 through F14 against current source. Classify each as confirmed, already fixed, a usability gap, or requiring verification.
3. Run lint, unit tests, end-to-end tests, and production build. Record pre-existing failures separately.
4. Prepare fixtures for mixed sources, filtered search, edits, invalid vectors, missing summaries, repeated imports, expired OAuth, long sources, and unavailable videos.
5. Verify backup behavior using disposable data. Correct testing instructions in `AGENTS.md`.

Success criteria:

- Each finding has a reproducible case or an explicit reason it is unconfirmed.
- Tests do not write to the live database or call paid providers by default.
- All seven panes have workflow checklists tied to current behavior.
- Baseline results and any changed estimates are recorded.

## Tracking

- I0: Integrate isolated calibration changes and record exact source state; acceptance: Nine bounded repairs retained; source fingerprint and regressions recorded.
- B0: Identify runtime/backend and seven-pane scope; acceptance: Bundle/backend/database identity known without changing live data; F01-F14 classified confirmed/fixed/gap/unconfirmed.
- B1: Triage baseline unit/browser failures and lint dependency crash; acceptance: Failures classified and resolved or approved deferrals; meaningful assertions retained.
- B2: Complete mixed-source and fault fixture matrix; acceptance: All fourteen findings mapped to fixtures and workflow acceptance.
- K0: Freeze restore/job/query/capture contracts and file ownership; acceptance: One owner per shared contract; unknown requirements exposed before delegation.