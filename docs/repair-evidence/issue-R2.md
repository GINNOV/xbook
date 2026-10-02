Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R2: Repair existing search

Calibration completed filter scoping before ranking, source-scoped Ask retrieval, and buffer-view decoding. Integrate the worktree changes and retain their regression checks. The remaining steps below still require acceptance.

What to do:

1. Define one validated query contract for source, category, folder, status, video, sorting, pagination, and text.
2. Integrate the calibrated filter-before-ranking and source-scoped Ask changes. Retain their regression checks and verify shared rules through the agent API.
3. Default semantic results to relevance. Preserve intentional alternative sorting and explain result limits.
4. Validate page numbers before fetching so displayed pages and data agree.
5. Preserve substring mode. Add an explicit exact-phrase or whole-word option where needed. Explain why `nomic` can match `economic` in substring mode.
6. Keep keyword search working when embeddings are unavailable. Show actionable semantic errors.

Success criteria:

- Every filter and filter combination is respected in keyword and semantic modes.
- YouTube searches contain no X results unless all sources were requested.
- Global candidate limits do not exclude relevant source-specific items prematurely.
- Relevance is the default semantic order. Pagination and counts remain consistent.
- Exact search distinguishes words from substrings, and existing agent queries stay compatible.

## Tracking

- Q1: Validate shared query and exact-text behavior; acceptance: Source/category/folder/status/video/sort/page/text contract agrees across library/agent; exact phrase/whole-word semantics explicit.
- Q2: Keyword fallback, result-limit and semantic error feedback; acceptance: Unavailable embeddings retain keyword search and actionable feedback.