# Repair coverage and acceptance record

Started 2026-10-02, Europe/Rome. Integration base f72454f. Worktree codex/complete-repairs. Primary untracked estimation documents and calibration worktree preserved. No desktop release authorized.

## Coverage

Each numbered requirement is tracked below; acceptance criteria are reproduced in linked GitHub issues. Status remains pending until checked against delivered default-branch code.

| Plan unit | Issue | Code ownership | Acceptance and dependency | State |
|---|---|---|---|---|
| R0.1 | https://github.com/GINNOV/xbook/issues/7 | AGENTS.md; tests/unit; tests/e2e; desktop runtime | Identify bundle version, loaded backend version, repository commit, active database path, and possible reuse of an existing server. | Pending |
| R0.2 | https://github.com/GINNOV/xbook/issues/7 | AGENTS.md; tests/unit; tests/e2e; desktop runtime | Reproduce F01 through F14 against current source. Classify each as confirmed, already fixed, a usability gap, or requiring verification. | Pending |
| R0.3 | https://github.com/GINNOV/xbook/issues/7 | AGENTS.md; tests/unit; tests/e2e; desktop runtime | Run lint, unit tests, end-to-end tests, and production build. Record pre-existing failures separately. | Pending |
| R0.4 | https://github.com/GINNOV/xbook/issues/7 | AGENTS.md; tests/unit; tests/e2e; desktop runtime | Prepare fixtures for mixed sources, filtered search, edits, invalid vectors, missing summaries, repeated imports, expired OAuth, long sources, and unavailable videos. | Pending |
| R0.5 | https://github.com/GINNOV/xbook/issues/7 | AGENTS.md; tests/unit; tests/e2e; desktop runtime | Verify backup behavior using disposable data. Correct testing instructions in `AGENTS.md`. | Pending |
| R1.1 | https://github.com/GINNOV/xbook/issues/8 | src/lib/db-backup.ts; src/lib/db.ts; database API; DatabaseSettings.tsx; PR4/5 | Replace raw active-file backup copies with a consistent SQLite snapshot supported by the adapter. Verify concurrent writes and WAL behavior using the [SQLite backup guidance](https://www.sqlite.org/backup.html). | Root accepted locally; merge pending |
| R1.2 | https://github.com/GINNOV/xbook/issues/8 | src/lib/db-backup.ts; src/lib/db.ts; database API; DatabaseSettings.tsx; PR4/5 | Stage restore files. Check integrity, required tables, and schema compatibility before replacing the active database. | Root accepted locally; merge pending |
| R1.3 | https://github.com/GINNOV/xbook/issues/8 | src/lib/db-backup.ts; src/lib/db.ts; database API; DatabaseSettings.tsx; PR4/5 | Block conflicting writes, create a recovery snapshot, replace safely, reconnect, and roll back on failure. | Root accepted locally; merge pending |
| R1.4 | https://github.com/GINNOV/xbook/issues/8 | src/lib/db-backup.ts; src/lib/db.ts; database API; DatabaseSettings.tsx; PR4/5 | Prevent silent overwrite when a custom backup name already exists. Explain that desktop backups are local and may contain stored credentials and technical logs. | Root accepted locally; merge pending |
| R1.5 | https://github.com/GINNOV/xbook/issues/8 | src/lib/db-backup.ts; src/lib/db.ts; database API; DatabaseSettings.tsx; PR4/5 | Preserve current confirmation dialogs. Keep clear and delete operations outside live automated verification. | Root accepted locally; merge pending |
| R2.1 | https://github.com/GINNOV/xbook/issues/9 | src/lib/bookmarks.ts; bookmark query schema; agent/library routes; FilterControls.tsx | Define one validated query contract for source, category, folder, status, video, sorting, pagination, and text. | Accepted locally; new E2E cases pending; merge pending |
| R2.2 | https://github.com/GINNOV/xbook/issues/9 | src/lib/bookmarks.ts; bookmark query schema; agent/library routes; FilterControls.tsx | Integrate the calibrated filter-before-ranking and source-scoped Ask changes. Retain their regression checks and verify shared rules through the agent API. | Accepted locally; new E2E cases pending; merge pending |
| R2.3 | https://github.com/GINNOV/xbook/issues/9 | src/lib/bookmarks.ts; bookmark query schema; agent/library routes; FilterControls.tsx | Default semantic results to relevance. Preserve intentional alternative sorting and explain result limits. | Accepted locally; new E2E cases pending; merge pending |
| R2.4 | https://github.com/GINNOV/xbook/issues/9 | src/lib/bookmarks.ts; bookmark query schema; agent/library routes; FilterControls.tsx | Validate page numbers before fetching so displayed pages and data agree. | Accepted locally; new E2E cases pending; merge pending |
| R2.5 | https://github.com/GINNOV/xbook/issues/9 | src/lib/bookmarks.ts; bookmark query schema; agent/library routes; FilterControls.tsx | Preserve substring mode. Add an explicit exact-phrase or whole-word option where needed. Explain why `nomic` can match `economic` in substring mode. | Accepted locally; new E2E cases pending; merge pending |
| R2.6 | https://github.com/GINNOV/xbook/issues/9 | src/lib/bookmarks.ts; bookmark query schema; agent/library routes; FilterControls.tsx | Keep keyword search working when embeddings are unavailable. Show actionable semantic errors. | Accepted locally; new E2E cases pending; merge pending |
| R3.1 | https://github.com/GINNOV/xbook/issues/10 | prisma/schema.prisma; migrations; embedding-index.ts; embedding-job.ts; llm.ts | Store model identity, dimensions, indexed-content hash, and generation time through additive migrations. | Pending |
| R3.2 | https://github.com/GINNOV/xbook/issues/10 | prisma/schema.prisma; migrations; embedding-index.ts; embedding-job.ts; llm.ts | Mark vectors stale after searchable content changes through the interface, enrichment, or agent API. | Pending |
| R3.3 | https://github.com/GINNOV/xbook/issues/10 | prisma/schema.prisma; migrations; embedding-index.ts; embedding-job.ts; llm.ts | Retain the calibrated byte-view decoding repair. Add validation of dimensions, finite values, and nonzero magnitude. | Pending |
| R3.4 | https://github.com/GINNOV/xbook/issues/10 | prisma/schema.prisma; migrations; embedding-index.ts; embedding-job.ts; llm.ts | Treat unknown legacy vectors as requiring verification or rebuild. Do not invent model identities. | Pending |
| R3.5 | https://github.com/GINNOV/xbook/issues/10 | prisma/schema.prisma; migrations; embedding-index.ts; embedding-job.ts; llm.ts | Provide a controlled model-change rebuild with progress and keyword fallback. | Pending |
| R3.6 | https://github.com/GINNOV/xbook/issues/10 | prisma/schema.prisma; migrations; embedding-index.ts; embedding-job.ts; llm.ts | Reject obsolete indexing results when the bookmark changed during generation. | Pending |
| R4.1 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Define honest outcomes for complete success, partial failure, total failure, cancellation, and work remaining. Separate preflight failures from item failures. | P1 accepted locally (35 tests); broader R4 acceptance pending |
| R4.2 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Persist server-owned continuation for enrichment and indexing. Integrate imports in R5. | Pending |
| R4.3 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Persist scope, settings snapshots, checkpoints, retry counts, and cancellation. Make submission idempotent. | Pending |
| R4.4 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Prevent duplicate work through database claims or leases. Recover interrupted operations at startup. | Pending |
| R4.5 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Retry transient failures within a budget. Stop configuration errors early and link to the relevant settings. | Pending |
| R4.6 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Make stop controls, event reconnection, and counters consistent across Dashboard, Folders, Processing, and single-item actions. | Pending |
| R4.7 | https://github.com/GINNOV/xbook/issues/11 | processing.ts; operation jobs; enrichment routes; startup; action hooks; run history | Correct historical outcome displays from trustworthy recorded counters without rewriting logs as successful. | Pending |
| R5.1 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Link folder names and counts to the correctly scoped library. | Pending |
| R5.2 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Apply R4's lifecycle to X imports, Import all, YouTube playlist actions, and dashboard imports. | Pending |
| R5.3 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Preserve checkpoints and cap rules. Distinguish new, refreshed, skipped, and unavailable entries. | Pending |
| R5.4 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Verify assignment updates for existing items and preserve manual enrichment during refresh. | Pending |
| R5.5 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Explain whether each action syncs names, imports, summarizes, or indexes. Use consistent labels across sources. | Pending |
| R5.6 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Show local counts and activity dates. Retain source changes already implemented. Avoid window reloads that discard context. | Pending |
| R5.7 | https://github.com/GINNOV/xbook/issues/12 | x.ts; youtube.ts; import routes; folders panels/hooks; operation jobs | Distinguish playlist entries from unique videos where duplicates exist. Preserve existing IDs and memberships. Defer canonical merging unless a confirmed defect requires it. | Pending |
| R6.1 | https://github.com/GINNOV/xbook/issues/13 | youtube.ts; schema/migrations; raw metadata backfill; bookmark displays | Map uploaders from `videoOwnerChannelTitle` and `videoOwnerChannelId`, with explicit handling for missing values. | Pending |
| R6.2 | https://github.com/GINNOV/xbook/issues/13 | youtube.ts; schema/migrations; raw metadata backfill; bookmark displays | Store playlist-addition time separately. Use `contentDetails.videoPublishedAt` or authoritative video metadata for Posted. | Pending |
| R6.3 | https://github.com/GINNOV/xbook/issues/13 | youtube.ts; schema/migrations; raw metadata backfill; bookmark displays | Backfill from stored raw data when possible. Bound quota-aware metadata fetches when needed. | Pending |
| R6.4 | https://github.com/GINNOV/xbook/issues/13 | youtube.ts; schema/migrations; raw metadata backfill; bookmark displays | Represent deleted, private, or unavailable items honestly. Retain useful prior captured content with an availability label. | Pending |
| R6.5 | https://github.com/GINNOV/xbook/issues/13 | youtube.ts; schema/migrations; raw metadata backfill; bookmark displays | Prevent unavailable or title-only items from receiving unsupported confident digests. | Pending |
| R7.1 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Share extraction between single and bulk processing. Clear obsolete failure state after a successful retry. | Pending |
| R7.2 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Extract article bodies with bounded size, redirects, and timeouts. Validate protocols and public-web destinations. | Pending |
| R7.3 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Store capture method, completeness, language, timestamps, and failure reasons separately from generated summaries. | Pending |
| R7.4 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Process long material in bounded sections instead of silent truncation. Retain transcript timestamps when available. | Pending |
| R7.5 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Give Ask useful evidence within its context budget. Include exact keyword candidates when semantic retrieval misses them. | Pending |
| R7.6 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Validate citation IDs against supplied evidence. Show supporting excerpts and video timestamps. Decline unsupported answers. | Pending |
| R7.7 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Preserve human corrections during ordinary reprocessing. Offer an explicit replace option and record generation provenance. | Pending |
| R7.8 | https://github.com/GINNOV/xbook/issues/14 | source-evidence.ts; transcript/article capture; llm.ts; enrichment and Ask routes; inspector | Preserve the target-language setting's documented translation meaning. Make summary-language behavior explicit without silently expanding that setting's scope. | Pending |
| R8.1 | https://github.com/GINNOV/xbook/issues/15 | settings hooks/forms; test APIs; OAuth routes; settings.ts | Distinguish configured, tested, disconnected, expired, and unavailable states. | Pending |
| R8.2 | https://github.com/GINNOV/xbook/issues/15 | settings hooks/forms; test APIs; OAuth routes; settings.ts | Add separate small chat and embedding tests using the displayed draft values consistently. | Pending |
| R8.3 | https://github.com/GINNOV/xbook/issues/15 | settings hooks/forms; test APIs; OAuth routes; settings.ts | Verify save feedback, dirty-state handling, presets, tab changes, and numeric validation. | Pending |
| R8.4 | https://github.com/GINNOV/xbook/issues/15 | settings hooks/forms; test APIs; OAuth routes; settings.ts | Correct batch help to describe items per operation batch. Separate it from response tokens and concurrency. | Pending |
| R8.5 | https://github.com/GINNOV/xbook/issues/15 | settings hooks/forms; test APIs; OAuth routes; settings.ts | Verify OAuth expiry, refresh, callbacks, cancellation, and disconnect in isolated cases. Keep source fixes already present. | Pending |
| R8.6 | https://github.com/GINNOV/xbook/issues/15 | settings hooks/forms; test APIs; OAuth routes; settings.ts | Explain local, LAN, and remote destinations, sent content, and technical-log storage. Keep secrets masked in diagnostics. | Pending |
| R9.1 | https://github.com/GINNOV/xbook/issues/16 | bookmarks predicates; list/inspector/actions; filters; dashboard counts | Add filters for existing unread, failed, blocked, stale-index, and unindexed states. Share predicates with dashboard counts. | Pending |
| R9.2 | https://github.com/GINNOV/xbook/issues/16 | bookmarks predicates; list/inspector/actions; filters; dashboard counts | Display read, edited, and processing states independently so an edit cannot hide a failure. | Pending |
| R9.3 | https://github.com/GINNOV/xbook/issues/16 | bookmarks predicates; list/inspector/actions; filters; dashboard counts | Improve the existing inspector for narrow windows without forcing the wide metadata table into the reading area. | Pending |
| R9.4 | https://github.com/GINNOV/xbook/issues/16 | bookmarks predicates; list/inspector/actions; filters; dashboard counts | Verify edit, read toggle, reprocess, translation, and close actions. Reject stale responses after selection changes. | Pending |
| R9.5 | https://github.com/GINNOV/xbook/issues/16 | bookmarks predicates; list/inspector/actions; filters; dashboard counts | Preserve filter and sort context. Provide accessible names, predictable keyboard focus, appropriate Escape dismissal, and retry feedback. | Pending |
| R10.1 | https://github.com/GINNOV/xbook/issues/17 | dashboard fetcher/UI; useUpdater.ts; identity API; Docs; README; developer.md | State semantic coverage's denominator. Separate library coverage, pending enrichment, missing vectors, and stale or incompatible vectors. | Pending |
| R10.2 | https://github.com/GINNOV/xbook/issues/17 | dashboard fetcher/UI; useUpdater.ts; identity API; Docs; README; developer.md | Link dashboard counts to matching scoped views. | Pending |
| R10.3 | https://github.com/GINNOV/xbook/issues/17 | dashboard fetcher/UI; useUpdater.ts; identity API; Docs; README; developer.md | Use source-specific last-sync information. Separate local import limits from provider quotas and LLM usage. | Pending |
| R10.4 | https://github.com/GINNOV/xbook/issues/17 | dashboard fetcher/UI; useUpdater.ts; identity API; Docs; README; developer.md | Show app version and useful backend identity. Expose update-check failure and retry feedback. Do not install an update during verification. | Pending |
| R10.5 | https://github.com/GINNOV/xbook/issues/17 | dashboard fetcher/UI; useUpdater.ts; identity API; Docs; README; developer.md | Use a neutral indicator for normal processing and reserve alerts for failures. | Pending |
| R10.6 | https://github.com/GINNOV/xbook/issues/17 | dashboard fetcher/UI; useUpdater.ts; identity API; Docs; README; developer.md | Update Docs, README, developer instructions, and API examples. Correct source-toggle instructions, privacy language, folder actions, outcomes, and backup terminology. | Pending |
| R11.1 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Run `npm run lint`, `npm run test`, `npm run test:e2e`, and `npm run build`. Resolve regressions and distinguish unrelated baseline failures. | Pending |
| R11.2 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Exercise import, enrich, index, filter, read, edit, translate, folder processing, settings, and documentation navigation using isolated data. | Pending |
| R11.3 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Verify interruption, resume, provider errors, cancellation, event reconnection, and duplicate requests. | Pending |
| R11.4 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Migrate a copy of a pre-change database. Check bookmarks, memberships, settings, read state, manual edits, logs, and agent IDs. | Pending |
| R11.5 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Back up and restore migrated fixtures. Verify desktop startup and workers using repository build procedures. | Pending |
| R11.6 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Measure a fixed search-query set and documented library sizes. Separate embedding-provider latency from local ranking time. Report known-item recall among the first five results and remaining failures. | Pending |
| R11.7 | https://github.com/GINNOV/xbook/issues/18 | tests/unit; tests/e2e; desktop fixtures; migrated SQLite; benchmark; evidence | Use C1 only for acceptance defects and contingency. Do not fill unused time with unapproved features. | Pending |

## Remaining acceptance units

| Unit | Issue | Dependencies | Acceptance | State |
|---|---|---|---|---|
| I0 | https://github.com/GINNOV/xbook/issues/7 | None | Nine bounded repairs retained; source fingerprint and regressions recorded. | Pending |
| B0 | https://github.com/GINNOV/xbook/issues/7 | I0 | Bundle/backend/database identity known without changing live data; F01-F14 classified confirmed/fixed/gap/unconfirmed. | Pending |
| B1 | https://github.com/GINNOV/xbook/issues/7 | I0 | Failures classified and resolved or approved deferrals; meaningful assertions retained. | Pending |
| B2 | https://github.com/GINNOV/xbook/issues/7 | I0 | All fourteen findings mapped to fixtures and workflow acceptance. | Pending |
| K0 | https://github.com/GINNOV/xbook/issues/7 | B0, B1, B2 | One owner per shared contract; unknown requirements exposed before delegation. | Pending |
| D1 | https://github.com/GINNOV/xbook/issues/8 | K0 | Integrity, required tables and migration version validated; corrupt/incompatible/traversal candidates leave active fixture untouched. | Root accepted locally; merge pending |
| D4 | https://github.com/GINNOV/xbook/issues/8 | D1 | Cross-process maintenance ownership and startup journal recover a process killed during staged replacement. | Root accepted locally; merge pending |
| D2 | https://github.com/GINNOV/xbook/issues/8 | D4 | Concurrent writes excluded across backend processes; restored fixture accepts Prisma writes. | Root accepted locally; merge pending |
| D3 | https://github.com/GINNOV/xbook/issues/8 | D2 | Injected swap/reconnect/crash failures recover original records and relationships. | Root accepted locally; merge pending |
| Q1 | https://github.com/GINNOV/xbook/issues/9 | D3 | Source/category/folder/status/video/sort/page/text contract agrees across library/agent; exact phrase/whole-word semantics explicit. | Accepted locally; new E2E cases pending; merge pending |
| Q2 | https://github.com/GINNOV/xbook/issues/9 | Q1 | Unavailable embeddings retain keyword search and actionable feedback. | Accepted locally; new E2E cases pending; merge pending |
| M1 | https://github.com/GINNOV/xbook/issues/10 | Q1 | All indexed writes share identity; old rows preserved with unknown identities. | Pending |
| M2 | https://github.com/GINNOV/xbook/issues/10 | M1 | Bad dimensions/bytes/nonfinite/zero/incompatible vectors do not rank. | Pending |
| M3 | https://github.com/GINNOV/xbook/issues/10 | M2 | Restartable rebuild includes incompatible non-null vectors and preserves edits and IDs. | Pending |
| Y1 | https://github.com/GINNOV/xbook/issues/13 | M3 | Creator/publication/addition remain distinct; unknown/private/deleted states honest. | Pending |
| P1 | https://github.com/GINNOV/xbook/issues/11 | D3 | Success/partial/failure/stop/preflight/work-remaining agree in API and history. | P1 accepted locally (35 tests); remaining R4 units pending |
| P2 | https://github.com/GINNOV/xbook/issues/11 | P1, M3 | Crash/duplicate requests preserve checkpoint and intervening human edits. | Pending |
| P3 | https://github.com/GINNOV/xbook/issues/11 | P2 | Enrichment and embedding continue autonomously after navigation/restart; competing desktop/dev workers fenced. | Pending |
| P4 | https://github.com/GINNOV/xbook/issues/11 | P3 | Retries bounded; configuration failures stop early; supported calls abort on stop. | Pending |
| P5 | https://github.com/GINNOV/xbook/issues/11 | P4, Q2 | Dashboard/folder/processing controls agree; ambiguous old outcomes not fabricated. | Pending |
| F1 | https://github.com/GINNOV/xbook/issues/12 | Q2 | Local folder scope including empty state opens correctly; actions named accurately. | Pending |
| F2 | https://github.com/GINNOV/xbook/issues/12 | P4, Y1 | Refresh preserves IDs, assignments and manual enrichment; caps checkpoint correctly. | Pending |
| F3 | https://github.com/GINNOV/xbook/issues/12 | F2 | Navigation/restart preserve per-folder progress and prevent duplicate commits. | Pending |
| F4 | https://github.com/GINNOV/xbook/issues/12 | F3, F1 | Entry/unique-video counts labeled; repeated import and refresh preserve context. | Pending |
| Y2 | https://github.com/GINNOV/xbook/issues/13 | Y1, P3 | Two backfills stable; quota/cap checkpoint and read/edit/ID preservation verified. | Pending |
| E1 | https://github.com/GINNOV/xbook/issues/14 | Y2, P4 | Article/transcript/fallback capture preserves V6 evidence; unavailable/title-only source eligibility enforced in backend. | Pending |
| E0 | https://github.com/GINNOV/xbook/issues/14 | E1 | Ordinary reprocess preserves prior human corrections; explicit replacement recorded; concurrent edits still win. | Pending |
| E2 | https://github.com/GINNOV/xbook/issues/14 | E0 | Redirect/public-destination/size/stalled-body/extraction fixtures pass. | Pending |
| E3 | https://github.com/GINNOV/xbook/issues/14 | E2 | Timeout covers body; stop cancels capture; successful retry clears obsolete errors. | Pending |
| E4 | https://github.com/GINNOV/xbook/issues/14 | E3 | Tail facts survive bounded section/final summary with honest partial status. | Pending |
| E5 | https://github.com/GINNOV/xbook/issues/14 | E4, M2, Q1 | Scoped exact evidence missed by summary vectors can enter Ask without budget overflow. | Pending |
| E6 | https://github.com/GINNOV/xbook/issues/14 | E5 | Unknown IDs rejected; citations resolve supplied evidence; unsupported fixtures decline. | Pending |
| Y3 | https://github.com/GINNOV/xbook/issues/13 | E0, F4 | Prior capture readable with limits; backend eligibility verified; explicit replacement choice shown without forced overwrite. | Pending |
| S1 | https://github.com/GINNOV/xbook/issues/15 | F3, M2 | Displayed draft values tested independently; model name alone does not imply ready. | Pending |
| S2 | https://github.com/GINNOV/xbook/issues/15 | S1, P5, Y3 | Invalid numbers blocked; draft/preset/tab/save states correct; local/LAN/remote/log-storage help accurate and diagnostics masked. | Pending |
| S3 | https://github.com/GINNOV/xbook/issues/15 | S1 | Both connectors isolated expiry/refresh/callback/cancel/disconnect cases preserve data and give recovery. | Pending |
| L1 | https://github.com/GINNOV/xbook/issues/16 | E6, P1 | Unread/failed/blocked/stale/unindexed query results match counts. | Pending |
| L2 | https://github.com/GINNOV/xbook/issues/16 | L1, S2 | Read/edit/failure states remain independent and filter context preserved. | Pending |
| L3 | https://github.com/GINNOV/xbook/issues/16 | L2 | A response cannot appear in B; retry/focus/Escape and 900/390px journeys pass. | Pending |
| H1 | https://github.com/GINNOV/xbook/issues/17 | L3, F4 | Coverage/links/source sync/counts agree; quotas, local caps and LLM usage distinct; normal processing neutral. | Pending |
| H2 | https://github.com/GINNOV/xbook/issues/17 | S3, P3 | Unavailable updater has retry status and does not block startup; no update installed. | Pending |
| H3 | https://github.com/GINNOV/xbook/issues/17 | H1, H2, E6, S2 | Seven-pane Docs/README/AGENTS/API examples agree with behavior and remote-content/privacy/log semantics. | Pending |
| T1 | https://github.com/GINNOV/xbook/issues/14 | E6, S3 | Approved endpoint supports tail/unsupported/partial questions and documented translation. | Pending |
| T2 | https://github.com/GINNOV/xbook/issues/18 | T1, H3 | Seven-pane checks include duplicate/stop/provider-error/reconnect cases; ordinary acceptance defects fixed; unapproved required failures remain open. | Pending |
| T3 | https://github.com/GINNOV/xbook/issues/18 | T2 | Bookmark content/settings/logs/agent IDs/memberships/read/manual edits preserved under migrated restore. | Pending |
| T4 | https://github.com/GINNOV/xbook/issues/18 | T3 | npm run build:desktop then npx tauri build, with isolated startup start disposable bundle/DB/port; hot reload, port reuse, stop/restart and ownership checked; cold toolchain extra. | Pending |
| T5 | https://github.com/GINNOV/xbook/issues/18 | T4 | Documented fixture sizes, known-item top5 recall and provider/local latency recorded. | Pending |
| C1 | https://github.com/GINNOV/xbook/issues/18 | T5 | Integration defects fixed and affected journeys rechecked without adding features. | Pending |
| T6 | https://github.com/GINNOV/xbook/issues/18 | C1 | Changed files/evidence/outstanding checks delivered for review. | Pending |

## Existing overlapping issues

- [PR #4](https://github.com/GINNOV/xbook/pull/4) merged at [1da4309a4799feaa27f752ef9ec86b994786c67c](https://github.com/GINNOV/xbook/commit/1da4309a4799feaa27f752ef9ec86b994786c67c). [Issue #1](https://github.com/GINNOV/xbook/issues/1) is closed; [resolution comment](https://github.com/GINNOV/xbook/issues/1#issuecomment-5954727468) confirmed.
- [PR #5](https://github.com/GINNOV/xbook/pull/5) merged at [bfddbc17092b811af07cf7e4cda7c503a11c6dde](https://github.com/GINNOV/xbook/commit/bfddbc17092b811af07cf7e4cda7c503a11c6dde). [Issue #3](https://github.com/GINNOV/xbook/issues/3) is closed; [resolution comment](https://github.com/GINNOV/xbook/issues/3#issuecomment-5954727840) confirmed.
- #2 Windows binary is closed externally and remains outside the repair findings. PR #6 is separate Windows work requiring Windows desktop acceptance; this audit neither changes its state nor authorizes a desktop release.
- Nine calibration repairs copied into this isolated worktree, original files untouched. PR #60 now contains overlapping calibration repairs; their default-branch acceptance still requires verification.
- N1/N2 personal notes and Markdown export are conditional additions requiring separate post-repair approval, excluded. Broader backlog remains excluded.

## Confirmed local acceptance

- R1 is locally accepted with 18 restore tests and isolated HTTP/browser verification of backup, confirmation, local/upload restore, preserved human edits/read/folders/settings, subsequent guarded writes and rejection cases. See [restore acceptance](repair-evidence/restore-acceptance.md). Issue #8 was closed externally by PR #60; its stronger verified R1 implementation still awaits integration. GitHub closure does not establish R1 acceptance on main.
- R2 is locally accepted with the 341-test suite, 20 new query tests and 64 focused root checks. The newly added end-to-end cases remain pending. Issue #9 was closed externally by PR #60; integration and those cases remain acceptance work.
- R4 has only P1 locally accepted, with 35 checks. P2 and the other R4 units remain pending; issue #11 was closed externally by PR #60.

## Concurrent default-branch changes

[PR #60](https://github.com/GINNOV/xbook/pull/60) merged externally at `e631dd49e5340d4bc4e0ebfe6ec5bdf2b2c7dbac` while this work was isolated. Issues #7–29 are observed closed and #30–59 open. These states are recorded separately from implementation acceptance. PR #60 reports failing lint and no Playwright run; its reported unit/build results do not satisfy R11. No issue states were changed by this audit.

All 41 full issue bodies and their comment collections (#19–59; all collections empty) were read. The active acceptance criteria, body hashes, owners and related steps are retained in `repair-issues.json`; historical combined-report material is not counted twice. [The concurrent-main audit](repair-evidence/concurrent-main-audit.md) records source evidence and residual requirements. The scoped issues refine existing R0–R11 work; they do not add N1/N2 or Windows/release scope.

| Scoped issues | Existing plan owner / acceptance units | Coverage relationship |
|---|---|---|
| [#19](https://github.com/GINNOV/xbook/issues/19) | R1; D1 / D4 / D2 / D3 | defect remains |
| [#20](https://github.com/GINNOV/xbook/issues/20) | R2, related R7; Q1 / Q2 / E5 | partial |
| [#21](https://github.com/GINNOV/xbook/issues/21) | R3; M1 / M3 | partial |
| [#22](https://github.com/GINNOV/xbook/issues/22) | R4; P1 / P4 / P5 | partial |
| [#23](https://github.com/GINNOV/xbook/issues/23) | R5; F1 / F2 / F3 / F4 | partial |
| [#24](https://github.com/GINNOV/xbook/issues/24) | R6; Y1 / Y2 | partial |
| [#25](https://github.com/GINNOV/xbook/issues/25) | R7; E1 / E2 / E3 / E4 | partial |
| [#26](https://github.com/GINNOV/xbook/issues/26) | R8; S1 / S2 / S3 | defect remains |
| [#27](https://github.com/GINNOV/xbook/issues/27) | R9, related R2; L1 / L2 / L3 / Q1 | partial |
| [#28](https://github.com/GINNOV/xbook/issues/28) | R10, related R3; H1 / M2 | defect remains |
| [#29](https://github.com/GINNOV/xbook/issues/29) | R10; H3 | partial |
| [#30](https://github.com/GINNOV/xbook/issues/30) | R1; R1.1 | core present; acceptance pending |
| [#31](https://github.com/GINNOV/xbook/issues/31) | R1; R1.4 | core present; acceptance pending |
| [#32](https://github.com/GINNOV/xbook/issues/32) | R2; R2.3 | core present; acceptance pending |
| [#33](https://github.com/GINNOV/xbook/issues/33) | R2; R2.4 | core present; acceptance pending |
| [#34](https://github.com/GINNOV/xbook/issues/34) | R3, related R2; M2 | core present; acceptance pending |
| [#35](https://github.com/GINNOV/xbook/issues/35) | R3; M1 / M2 / M3 | defect remains |
| [#36](https://github.com/GINNOV/xbook/issues/36) | R4, related R5; P2 / P3 / F3 | defect remains |
| [#37](https://github.com/GINNOV/xbook/issues/37) | R4, related R5; P2 / P3 / F3 | defect remains |
| [#38](https://github.com/GINNOV/xbook/issues/38) | R4, related R5; P4 / P5 / F3 | partial |
| [#39](https://github.com/GINNOV/xbook/issues/39) | R5; F4 | defect remains |
| [#40](https://github.com/GINNOV/xbook/issues/40) | R6; Y1 / Y2 | partial |
| [#41](https://github.com/GINNOV/xbook/issues/41) | R6, related R7; Y1 / Y3 / E1 | defect remains |
| [#42](https://github.com/GINNOV/xbook/issues/42) | R7, related R6; E1 / E4 / Y3 | partial |
| [#43](https://github.com/GINNOV/xbook/issues/43) | R7; E5 / E6 | defect remains |
| [#44](https://github.com/GINNOV/xbook/issues/44) | R7; E3 | core present; acceptance pending |
| [#45](https://github.com/GINNOV/xbook/issues/45) | R7, related R5; E0 / F2 | partial |
| [#46](https://github.com/GINNOV/xbook/issues/46) | R7; E2 | defect remains |
| [#47](https://github.com/GINNOV/xbook/issues/47) | R7; E2 / E3 / E4 | defect remains |
| [#48](https://github.com/GINNOV/xbook/issues/48) | R8; S1 / S2 | defect remains |
| [#49](https://github.com/GINNOV/xbook/issues/49) | R8, related R10; R8.4 / H3 | core present; acceptance pending |
| [#50](https://github.com/GINNOV/xbook/issues/50) | R8, related R2, R4; S2 / Q1 / P1 | defect remains |
| [#51](https://github.com/GINNOV/xbook/issues/51) | R9; L2 | defect remains |
| [#52](https://github.com/GINNOV/xbook/issues/52) | R9; L3 | defect remains |
| [#53](https://github.com/GINNOV/xbook/issues/53) | R9, related R3; L3 / M1 | core present; acceptance pending |
| [#54](https://github.com/GINNOV/xbook/issues/54) | R9; L3 | defect remains |
| [#55](https://github.com/GINNOV/xbook/issues/55) | R10, related R6; H1 | defect remains |
| [#56](https://github.com/GINNOV/xbook/issues/56) | R10, related R0, R11; H2 / B0 / T4 | partial |
| [#57](https://github.com/GINNOV/xbook/issues/57) | R10; H1 | partial |
| [#58](https://github.com/GINNOV/xbook/issues/58) | R10, related R8; H3 / S2 | core present; acceptance pending |
| [#59](https://github.com/GINNOV/xbook/issues/59) | R0, related R10, R11; R0.5 / H3 / T2 | core present; acceptance pending |

## Seven-pane workflows

- Dashboard: scoped metrics, import/enrich/index, stop, event reconnect and provider failure.
- X Library: scoped keyword/semantic/exact search, all state filters, edit/read/translate/reprocess, reader keyboard and responsive layout.
- YouTube Library: same library journey plus uploader/publication/addition/availability and captured evidence.
- Folders: scoped navigation including empty, sync/import/enrich labels, import all navigation/restart/caps/failure and counts.
- Processing: honest counters/outcomes, duplicate submission, retry/cancel/lease/restart and history.
- Settings: draft chat/embedding tests, readiness, numeric validation, presets/tabs/save, OAuth expiry/refresh/cancel/disconnect, backup/restore.
- Docs: navigation and accurate instructions/API/privacy for all seven panes.

## Findings

F01 confirmed unsafe raw restore; snapshot backup fixed in calibration. F02 scoped retrieval fixed in calibration, contracts remain. F03 freshness fixed in calibration, identity missing. F04 total failure fixed in embedding calibration, historical/other lifecycle remains. F05 client-owned continuation confirmed. F06 unlinked folder rows confirmed. F07 new-import mapping fixed in calibration, legacy repair remains. F08 unavailable/title-only eligibility unverified. F09 transcript evidence fixed partially in calibration; article and long summaries remain. F10 distinct draft embedding tests missing. F11 state filters missing; action races require workflow checks. F12 denominator excludes unsummarized source items. F13 AGENTS testing corrected by calibration; Docs/privacy remain. F14 installed bundle 0.4.0 and source 0.4.3; desktop identity and startup need isolated acceptance.

## Compatibility contracts

- Restore owner stages and validates before any migration. Preserve active database on validation failure. Exclude writers while replacing; retain recoverable original and journal through reconnection.
- Query contract additive: preserve existing substring requests, source and field names, sort override and pagination responses.
- Index metadata additive: unknown legacy identities never invented; preserve bookmark IDs and relationships.
- Jobs preserve existing request/response fields through adapters; persisted claims/checkpoints must fence stale writes and edits.
- Capture keeps original content separate from generated summaries. Ordinary reprocess preserves edited data; replacement explicit.
- Baseline agent owns dependencies and baseline tests. Root owns shared contracts and integration until accepted delegation.
