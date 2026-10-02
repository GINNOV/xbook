# R2 Q1/Q2 shared query contract

Implemented in the repair worktree on 2026-10-02. No migration or agent-write changes.

`src/lib/bookmark-query.ts` defines the Library and agent bookmark-read contract. It validates source, category, folder, state, content flags and text mode; normalizes boolean URL values, sort and pagination; and retains arbitrary source strings within the existing 32-character source limit. The Library fetcher and agent GET use the same schema. Invalid API filter values return 400. Invalid or out-of-range pagination retains the accepted normalization and effective-page behavior.

Text modes are explicit:

- `substring` is the existing default. A query for `nomic` can match `economic`.
- `word` requires every query token to appear as a complete token in the searchable fields. `nomic` does not match `economic`. Tokens may appear in different fields.
- `phrase` requires adjacent complete tokens in order within one field. `nomic embedding` matches `Nomic—embedding`, while reversed or separated words do not match. Matching normalizes Unicode compatibility characters, ignores case and treats punctuation as a separator.

Exact modes apply structured filters before reading matching fields, compute the exact-match total, then clamp and fetch the requested page. Only searchable text fields and IDs are read for the scoped match pass; vectors, raw payloads and event logs are fetched only for the displayed page. Exact modes currently scan those text fields within the filtered scope. A larger-library performance measurement remains part of final acceptance.

Semantic retrieval preserves the calibrated scope-before-ranking behavior and 50-result cap. Results carry explicit search-mode and cap metadata. Provider/retrieval failure falls back to keyword results within the same scope and selected text mode. Default relevance changes to newest imports; explicit non-relevance sorting survives. The UI names its search and filters accessibly, documents text modes and displays a status with a Settings recovery link. It does not display provider error details.

The schema includes unread, failed, blocked, stale and unindexed states for R9. Existing unread/failure/blocked/missing-vector predicates are implemented. At R2 handoff, stale filtering required the R3 embedding-identity predicate before exposure. R3 has now added the shared identity-based state predicate. Retrieval ownership remains with the coordinator.

## Evidence before R3 integration

- `r2-contract.log`: 69 focused checks passed, including 20 new real SQLite/API/page-contract checks and 49 existing scope, pagination and relevance calibration checks.
- `r2-unit.log`: full suite passed, 341 tests in 47 files.
- `r2-types.log`: `npx tsc --noEmit` passed.
- `r2-lint.log`: lint passed with the four existing unused-variable warnings.
- `r2-e2e.log`: both Chromium journeys passed in 6.9 seconds against the disposable migrated SQLite database. The journeys exercise exact word/phrase interactions, preserve scope and explicit sorting, and verify the unavailable-provider fallback with its Settings recovery link.

Legacy vector identity acceptance has not changed in R2. R3 owns exclusion/rebuild behavior and may need to update semantic fixtures with valid identities.

## R3 fixture compatibility

`r3-fixture-contract.log` records 93 passing checks across nine owned fixture files, including a real API model rebuild that changes ranking while preserving IDs/folders/read state and a SIGKILL/fresh-process checkpoint recovery. Semantic fixtures now carry actual content hashes, index timestamps and model/endpoint/dimension metadata. Old vector mocks remain for dependent checks; new identity-result mocks wrap them. The child-process test compiles the new helper dependencies and reports early crashes through captured stderr.

`r3-fixture-all.log` now records the full suite passing, 353 tests in 48 files, after the pagination and actual Ask-provider fixtures were updated. `r3-fixture-types.log` records a passing typecheck. The inspected browser screenshots are `r2-exact-search.png` and `r2-semantic-fallback.png`; they show the active exact text modes, preserved scope/sort and recovery banner.
