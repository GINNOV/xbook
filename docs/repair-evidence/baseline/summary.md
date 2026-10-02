# B1 baseline and integration checks

Checkout: `/Users/joseph/.codex/worktrees/complete-repairs/xbook`. Runtime: Node 24.21.0, installed under `/Users/joseph/.npm/_npx/387698761821791d/node_modules/.bin`. Commands, UTC timestamps, exit codes and durations are in `commands.jsonl`.

## Baseline corrections

- Replace the global `brace-expansion` 5 override with compatible overrides for minimatch 3 and 9. The former caused `npm ci` failure through an ESM/CommonJS mismatch.
- Add the real `bookmarkFolder.updateMany` contract to the folder-sync unit mock and assert its source-specific `lastFetchedAt` write.
- Derive idle dashboard index counts from current props. Keep a single progress state only during indexing, eliminating state updates inside the prop-sync effect.
- Select seeded processing rows by their run URLs instead of selecting navigation source icons.
- Open Dashboard Advanced actions and configure a fixture model before the multi-batch enrichment workflow. Assert the continuation carries the original run ID and source.
- Open Settings AI and Advanced before asserting logs and maintenance controls.
- Give the operations and UI suites different bookmark IDs. Use one worker because clearing all processing history is a global operation.
- Create a temporary database, migrate it before the test server starts, and remove it afterward. Playwright does not use the checkout or primary `dev.db`.
- Rename the stop-status test so it does not claim to verify cancellation of a server-side LLM request. It verifies the visible status and database state only.
- Update WAL snapshot acceptance fixtures for the export Request argument and credential-redaction schema. Retain concurrent writes, integrity checks, committed WAL data and temporary-file cleanup assertions.

## Latest results as of 2026-10-02 14:27 UTC

| Check | Result | Evidence |
| --- | --- | --- |
| Unit suite | 310 tests passed in 45 files | `unit-final3.log` |
| Chromium workflows | 6 passed against a migrated disposable database | `e2e-final3.log` |
| Lint | Passed with 4 existing unused-variable warnings and one newly introduced unused import in restore tests | `lint-final2.log` |
| Typecheck | Passed after integration owner corrected maintenance-client types | `types-final2.log` |
| Production build | Passed, with one broad migration-file tracing warning | `build-final.log` |

The earlier integration type failures are recorded in `types-final.log` and fixed before the passing rerun. The production build warns that the restore migration filesystem lookup traces the whole project. This warning is reported to the integration owner. The six browser checks do not constitute full repair acceptance for every workflow or server-side cancellation.
