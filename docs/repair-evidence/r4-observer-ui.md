# Durable operation observer UI acceptance

Enrichment, embedding rebuilds, X folder processing, YouTube playlist processing and individual Processing event reprocess actions submit one POST with an Idempotency-Key. Full enrichment/folder/index actions send full=true; explicit index rebuild also sends rebuild=true. The browser observes GET /api/processing/runs/[id] snapshots; counters are cumulative and never added together. Stop/resume target the same saved ID. Failure/paused/partial outcomes retain the checkpoint, remaining count, cause, Settings repair link and Resume control. Navigating away closes observation without stopping server work. Mount discovers scoped active jobs or restores the saved paused/stopped/failed operation. Observation errors retry automatically, including failed initial discovery. The processing SSE reconnect timer is cleaned up on unmount.

Validation (Node 24, October 2, 2026):

- Full unit suite: 388 tests in 52 files passed (r4-all-unit.log).
- Four observer behavior tests plus ten existing action/folder hook tests passed. Frozen LLM snapshot and provider tests also passed in the full suite.
- TypeScript passed (r4-ui-types.log).
- ESLint: zero errors, three backend unused-variable warnings (r4-ui-lint.log).
- Next production build passed (r4-ui-build.log).
- Two Chromium journeys passed against a disposable SQLite database and a real loopback OpenAI-compatible fixture provider (r4-ui-e2e.log). The first intentionally fails a GET progress request, confirms automatic reconnection, navigates away while server updates advance, reattaches the same ID, stops and resumes, and finishes with exactly six processed/updated items and exactly one enrichment POST. The second verifies unavailable-model preflight, Settings repair, and same-checkpoint resume after provider recovery.
- Screenshots r4-stopped-observer.png and r4-provider-recovery.png inspected for readable cumulative status and actionable recovery controls.

Remaining integration work: Process inbox still invokes the existing import followed by one durable full enrich and one durable full index operation. Those individual processing jobs survive navigation; server ownership of the complete import/enrich/index pipeline belongs to the following import stage. Dashboard library counts/recent activity currently retain server-rendered props until refresh; the observer itself reads authoritative counters and the library refresh stage must update surrounding counts.
