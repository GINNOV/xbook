# Lifecycle and capture contract audit

Read-only source audit, October 2, 2026. Scope is R4/R5 design and R7/R8/R9/R10 root causes. No production files or migrations changed. Restore acceptance must precede schema changes. The coordinator owns schema and integration.

## Confirmed lifecycle defects

- `src/app/api/enrich/route.ts` reconstructs attempted IDs from every bookmark event, including fetching. An interruption after fetching can permanently skip an unfinished item on resume.
- Its resume path reads source, folder, full/reprocess flags, batch size and concurrency from the next request and current settings. The stored run configuration does not control execution.
- Its finalizer records completed when work remains. Item counter increments can set a stopped run back to running. Run submission checks and creates in separate transactions.
- `src/lib/embedding-job.ts` has useful lease fencing and an item checkpoint but remains a separate lifecycle. `src/app/api/bookmarks/embeddings/sync/route.ts` starts work only inside requests. It checks current global settings against a partial snapshot rather than executing the stored configuration.
- No Next instrumentation startup continuation exists. `src/lib/signals.ts` abort controllers and events exist only inside one process. Import page tokens and Import all folder position are not persisted.
- SSE uses process-local events without replay. Reconnection has no authoritative database reconciliation.
- X and YouTube imports refresh `rawJson` with provider data. YouTube capture lives inside the same JSON under `xbookSourceEvidence`, so an import refresh removes stored capture.

## Proposed durable job contract

Use OperationRun as the public identity and history row. Keep existing configJson and counters compatible. Add nullable jobJson, nullable unique idempotencyKey, leaseOwner, leaseUntil, cancellation timestamp and an integer revision. These fields support indexed claims and compare-and-swap writes; a validated versioned jobJson stores the adapter state.

The envelope contains version, kind, immutable scope, immutable effective settings, retry policy, item or page checkpoint, pause/error reason and a settings repair destination. Scope explicitly stores source, folder IDs, selected bookmark IDs, full versus one-batch behavior and replaceEdited. Effective settings store chat/embedding endpoint and model, prompts, context/response limits, thinking, concurrency and batch size. Do not expose secrets through history or job API responses. Resolve authentication privately at execution and fail clearly if the saved account/configuration no longer exists.

For enrichment and indexing, freeze ordered candidate IDs at submission. Each item records pending, updated, failed or skipped, attempts and retryAt. Reading or fetching never changes it to terminal. For import, freeze the folder list and persist folder index, provider cursor, bounded page items and committed position. A folder failure records its error and permits later folders to continue. Cap pauses retain the exact page/cursor and cap reason.

Submission validates input and takes SQLite's write lock before checking overlap and creating the run. A caller-supplied idempotency key returns the original run on retry and rejects a different request with the same key. Without a key, an identical active operation can return its existing run; incompatible overlapping work returns 409. Conservatively serialize mutation jobs across the library at first, since global/folder scope overlaps and the product already rejects many simultaneous operations.

Claim uses an atomic conditional database update. A random owner and incrementing revision fence the worker. Renew while calls run. Every bookmark write, checkpoint and counter update shares one transaction that first verifies owner, unexpired lease, revision and no cancellation. A worker that loses its lease cannot publish data or finalize a run. Import record upsert, usage charge and checkpoint advance share that transaction, so crash replay cannot double-charge.

Cancellation is persisted before aborting any in-memory call. Poll cancellation during lease renewal and before each item/page. Stop prevents new calls and fenced writes even when another process owns the job. Explicit resume clears cancellation only through a dedicated transition. A normal increment never changes run status.

Statuses are queued, running, paused, completed, partial, failed and stopped. Completed requires zero remaining work and zero failures. Partial requires zero remaining work, at least one success and at least one failure. Failed includes total item failure and fatal preflight failure. Paused means work remains, with a cap or repair reason. Stopped means explicit cancellation. `processed = updated + failed + skipped`; retries and progress events are not extra processed items. Preflight failure may have zero processed items. History should derive legacy all-failed outcomes from trustworthy counters and preserve its original log.

An adapter implements prepare, preflight, next bounded unit, execute with AbortSignal and stored settings, transactionally commit, and calculate outcome. Enrich single/global/folder share one adapter. Embedding uses the same runner and existing guarded embedding write helper. X global/folder and YouTube playlist/import-all share an import adapter with source-specific pagination. Existing response fields remain, with additive run status and remaining-work fields. Routes submit or explicitly resume and wake the worker; browser loops become observers.

Next instrumentation starts one worker loop per process with a global guard for development reloads. Each loop scans durable queued jobs and expired running leases. Database fencing handles duplicate Next or desktop processes. Paused cap jobs wait for explicit continuation; transient retries wake at retryAt; configuration failures do not spin. Startup must avoid recovering older uncheckpointed runs blindly, because their events cannot prove completed writes. Mark those interrupted with a restart action.

SSE sends an initial durable snapshot and monotonically identified persisted events. The client refetches the authoritative run after connect/reconnect and periodically while active. Keep process events only as a latency optimization.

## Acceptance cases

Use disposable SQLite and injected providers. Verify duplicate submission, independent competing workers, lease expiration during a slow call, stop during an active call, crash after provider response before commit, restart after committed item, settings mutation between batches, preflight failure, total and partial failure, cap continuation, folder failure followed by successful folder, page replay without double charge and event reconnection. Test both generic runner and route compatibility.

## Capture and human-edit findings for R7

`src/app/api/enrich/route.ts` and `one/route.ts` duplicate article fetching. Both remove tags with regular expressions and keep the first 3,000 characters. They lack protocol, public destination and redirect validation. Capture metadata exists only for YouTube in `src/lib/source-evidence.ts`.

`transcriptSummaryText` selects at most six distributed sections and 10,000 characters. That is an honest partial preview, but it cannot satisfy full long-source summarization. `summarizeBookmark` subsequently slices input by context window. `generateEmbedding` slices at 8,000 characters. Ask has bounded transcript passages and citation IDs from the accepted calibration; retain that work and expand capture rather than replacing it.

`saveEnrichmentIfUnchanged` guards concurrent edits but ordinary reprocessing still overwrites a previously edited summary and clears editedAt. Default reprocess should retain edited summary/category/tags; explicit replacement is separate and records generation provenance. Clearing errors after a successful retry already exists in this helper. Import refresh must merge the capture key or store capture separately.

Use a versioned source-capture envelope shared by articles and transcripts, with source URL, method, status/completeness, language, capturedAt, failure reason, sections and timestamps where available. Bound network bytes and capture storage separately from model input. Summarize each bounded section and combine section summaries so a final-section fact remains available. Persist generation provenance separately from capture, including model/settings and limitation disclosure. Keep targetLanguage as translation's setting unless the user chooses a separate summary-language option.

## R8, R9 and R10 causes

- Settings test accepts x, yt and llm only. There is no embedding test. The LLM test falls back with `||`, so an explicitly empty draft can silently test a saved value. YouTube test ignores the displayed token and resolves saved authentication. Chat test uses the configured response limit instead of a small fixed probe. Readiness should bind to a tested settings fingerprint and invalidate after draft changes.
- SettingsProvider resets draft state whenever initial props change. Presets call setForm directly and do not set dirty. Save returns success without setting a visible success message. Numeric edits accept null and Number values; endpoint boundary validation must reject invalid operational values.
- `useBookmarksList.translate` publishes any response into translatedText after selection changes. Clearing translation on selection is insufficient because a late response repopulates it. Reprocess also sets selectedId after completion and can reopen an item the user closed. Each action needs a selection/request generation guard and AbortController where useful.
- StatusFilter currently supports pending and summarized only, though reusable failed/blocked predicates already exist. Define independent read/edit/process/index states and use the same predicates in counts and retrieval. Root R3 owns index compatibility definitions.
- EnrichmentSummary computes coverage over indexed plus unindexed enriched items. Pending library items disappear from the denominator. Display usable vectors divided by the full source library total, with a separate enriched-index coverage if useful. Preserve source-scoped import history already used by the dashboard page. Audit updater feedback separately in the desktop owner.

## R4 durable implementation evidence

The generic item runner now owns enrichment and indexing. A submission freezes candidate IDs and effective non-secret chat/embedding configuration. Its request fingerprint comes from normalized user input, so a matching idempotency key returns the original run before resolving changed settings or candidates. Configuration failures during submission create a failed history row with zero attempted items and a settings repair action.

Routes return the queued run ID immediately. Next instrumentation starts the worker with a per-process global guard and returns without awaiting provider work. Database leases and revisions prevent competing processes from committing the same item. Startup migrates valid older embedding checkpoints and gives restart guidance for uncheckpointed legacy enrichment/import records. Expired claims retain committed item results.

Cancellation persists its timestamp and invalidates the lease before aborting local calls. Other processes detect cancellation through polling at most once per second. Capture calls receive the same AbortSignal. Source capture writes use a fenced preparation transaction before summarization, so source evidence survives a later model failure. Generation writes and item counters share a fenced transaction. A SQLite savepoint rolls back any partial adapter writes before a failed checkpoint can commit.

Explicit resume preserves the frozen scope and successful checkpoints, resets eligible failures and counters, and rejects a different active operation while holding SQLite's write lock. Transient item and preflight retries retain their attempts and next retry time. Configuration faults stop early. History uses completed, partial, failed, paused and stopped outcomes. SSE reads database snapshots including event/log counts, so reconnects and workers in other processes are observable.

Owned production files are `src/lib/operation-job.ts`, `operation-adapters.ts`, `operation-api.ts`, `operation-worker.ts`, `src/instrumentation.ts`, enrichment and embedding route wrappers, and processing stop/resume/cleanup/event routes. Root owns the additive schema, embedding identity contract and LLM configuration APIs. The observer worker owns client controls and polling.

Verification includes a genuine independent worker process killed with SIGKILL, a competing live process claim, recovery of only unfinished IDs, a crash after the last durable commit, startup-loop reuse, frozen configuration after settings changes, immediate queued HTTP responses, idempotent replay after candidate/model changes, configuration failures with zero attempts, independent SQLite submissions, lease expiry, cross-connection cancellation, partial adapter-write rollback, resume conflicts, bounded retries and concurrency. Source-evidence fixtures retain separate capture after model failure. Disposable databases and synthetic bookmarks were used throughout.

The final focused check passed 107 tests across ten files. TypeScript and ESLint checks passed for the owned production files. Full-suite acceptance and browser/desktop acceptance belong to the coordinator.

R5 import pagination, cap checkpoints, Import all continuation and provider adapters remain pending. R7 article extraction, durable capture columns and full long-source summarization remain pending. This record does not claim those steps or desktop runtime acceptance complete.

## Implementation ownership proposal

P1 implementation accepted for review after root accepted R1. The shared outcome classifier now resolves old completed total failures, partial results and recorded pauses without changing historical records. Processing counter and finalizer helpers reserve SQLite's write lock and reject mutations of terminal rows. Paused rows reject item increments. History labels and filters use the same outcome definitions. Existing embedding endpoint response fields and calibration statuses remain compatible.

P1 verification passed `npx tsc --noEmit` and 35 tests across processing-outcomes-real-db, formatRunOutcome, enrich-resiliency and embedding-sync-outcome, using Node 24 and disposable SQLite. The stop/increment race ran twelve times; concurrent increments, terminal preservation, zero-attempt preflight errors, total/partial failure, remaining work and historical filtering passed. A nullable-notes filter defect found by the first fixture run was corrected and the complete focused group rerun. `git diff --check` passed for owned files. No schema changes or startup-worker implementation occurred in this step.

The lifecycle owner edits the runner, job schemas, startup hook, processing APIs, enrichment/import adapters and their focused tests. Root adds Prisma fields/migration after restore acceptance and supplies R3 embedding compatibility helpers. The interface owner updates actions/history/SSE to observe jobs after the contract is accepted. Capture work uses a shared source-evidence module and effective LLM config injection agreed with the lifecycle owner. No dependent edits are unlocked by this audit alone.
