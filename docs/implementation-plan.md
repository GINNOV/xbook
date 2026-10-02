# XBook repair and improvement plan

Status: Draft for review. The original three calibration repairs and six additional timed validation units were authorized and implemented in an isolated worktree. The full roadmap remains pending approval. See `docs/execution-estimate-validation-results.txt` for the latest scope, prospective forecast errors, and verification limitations. The dated budget below is historical. The current resource-constrained planning forecast is in `docs/execution-estimate-maximum-reasoning.txt` and `docs/estimate-model/`; it is not empirically validated.

Prepared: October 2, 2026. Time zone: Europe/Rome.

This revision replaces the earlier roadmap. Repair existing behavior across Dashboard, X Library, YouTube Library, Folders, Processing, Settings, and Docs first. Add features only after the repair checks pass and the user confirms a remaining workflow gap warrants them.

## Latest calibration status

The six additional units cover semantic default relevance, effective pagination, WAL-safe backup creation and download, index-freshness migration and guarded writes, persistent embedding checkpoints with request-driven restart recovery, and bounded YouTube transcript evidence through Ask. They are implemented in `/Users/joseph/.codex/worktrees/estimate-calibration/xbook` and have not been merged or installed.

Do not repeat those changes when the worktree is later integrated. R1 still needs safe restore and rollback. R2 still needs residual contract checks. R3 still needs model/dimension compatibility and a rebuild strategy. R4 still needs the broader enrichment/import/desktop lifecycle. R7 still needs article extraction, capture/backfill policy, larger-summary handling, and live answer verification. All other roadmap areas retain their uncompleted scope.

The original forecasts were frozen before this batch. Four of six outcomes landed within their ranges; median absolute percentage error was 59.15%, above the agreed 30% target. The score remains 3/5. Neither the 62-hour remaining-work budget nor the October 5 example is a validated prediction. Re-estimate the residual work after integrating these accepted units, and validate revised forecasts on fresh tasks before awarding 4/5. No full-roadmap execution is scheduled.

## Current implementation forecast and assignment order

The latest planning model covers 49 remaining acceptance units and assumes continuous GPT-6.1 Sol medium execution, three implementation subagents and one coordinator/reviewer, a warm environment and available endpoints. It reuses the nine accepted calibration repairs and budgets their integration once.

The base scenario takes 611.6 minutes, about 10 hours. Optimistic/adverse scenarios take about 5 and 23 hours; a named shared-failure stress takes about 25 hours. These are judgment scenarios, not confidence bounds or deadlines. The old 62-hour budget is superseded for planning by this model, while all prior forecast errors remain retained. Empirical reasoning score remains 3/5 until fresh forecasts pass validation.

Use `docs/estimate-model/tasks.json` for exact remaining assignments, ownership, dependency order and success criteria, and `schedule.csv` for modeled starts and finishes. Independent root acceptance unlocks each dependent task. Restore is accepted before migrations; shared schemas/files have one owner. Independent interface and backend work may overlap within those dependencies. Full repair acceptance precedes optional notes/export.

For an example approved T0 of October 2, 2026 at 16:00 Europe/Rome, base repair completion is October 3 at about 02:00, optimistic completion October 2 at about 21:00, adverse completion October 3 at about 15:00, and shared-stress completion October 3 at about 17:00. This is a reference calculation, not a scheduled run. Later start and blocking waits shift the dates. Cold dependencies/native builds add active time; processing the entire private library requires item counts and measured throughput in a separate schedule.

See `docs/execution-estimate-maximum-reasoning.txt` for the calculation, uncertainty, review findings and honest scoring, and `docs/estimate-model/validation-protocol.txt` for future measurement. No further implementation, live migration, release or unattended execution is authorized by these estimation documents.

## Use the inspection evidence correctly

The review combined repository inspection with a read-only walkthrough of the running desktop application identified by PID 67132. Its process path was `/Applications/xbook.app/Contents/MacOS/app`. Its bundle version was 0.4.0. The repository package version was 0.4.3.

The app displayed `localhost:3000`. Establish which backend it actually loads before treating an installed-app observation as a defect in the current source. Some interface differences are already addressed in the repository, including folder activity columns and library sort controls. Do not implement those changes twice.

The walkthrough opened both libraries and bookmark inspectors, both folder tabs, processing history and failed-run details, Settings tabs, YouTube connection details, AI advanced controls, database controls, Docs, and the Library reference. It exercised a keyword search.

It did not save settings, edit bookmarks, reconnect accounts, import content, invoke AI processing, clear history, restore data, or install an update. Those operations require isolated verification during implementation. This review does not claim they passed or failed in the live app. Do not copy private bookmark text or credentials into reports.

### Findings that determine the repair order

| ID | Pane or workflow | Evidence and problem | Step |
|---|---|---|---|
| F01 | Settings, Data | Source copies the database file directly for backups and deletes the active file before copying a restore. Restore integrity and rollback were not exercised. | R1 |
| F02 | Both libraries, agent API | Source semantic retrieval bypasses structured filters. Ask applies source filtering after global selection. | R2 |
| F03 | Edits and indexing | Source write paths can change indexed content without invalidating its vector. Vectors lack model and dimension metadata. | R3 |
| F04 | Processing | Live history shows runs with 100 failures labeled Completed. Source permits this outcome for some indexing failures. | R4 |
| F05 | Processing and imports | Source continuation depends on client loops. Enrichment can record completed while its notes say paused with work remaining. Recovery needs isolated verification. | R4, R5 |
| F06 | Folders | Live and source folder names and counts lack links into the library. X and YouTube have separate action and continuation logic. | R5 |
| F07 | YouTube Library | Live rows repeatedly show the same channel across unrelated videos. Source maps playlist-item channel and addition date as video creator and publication date. | R6 |
| F08 | YouTube Library | Live deleted-video rows can be marked Summarized. Digests do not explain whether a transcript, description, or title supported them. | R6, R7 |
| F09 | Enrichment and Ask | Source truncates article and transcript content. Ask supplies short excerpts. Single-item and bulk routes duplicate extraction logic. | R7 |
| F10 | Settings | Readiness chips indicate configured models, not tested models. There is no distinct embedding test. Batch help inaccurately describes items per LLM request. | R8 |
| F11 | Both libraries | Status choices are only All, Pending, and Summarized. Source lacks unread, failed, blocked, and unindexed filters. Action races need verification. | R9 |
| F12 | Dashboard | Live X dashboard says 100% searchable with 1,232 indexed and 297 pending out of 1,480 items. Source excludes unsummarized items from the percentage denominator. | R10 |
| F13 | Docs | Library docs describe both sidebar selection and a filter-bar source toggle. README privacy claims exceed remote-model behavior. AGENTS says tests are absent despite existing suites. | R0, R10 |
| F14 | Desktop | Bundle and repository versions differ. Update failures are mainly logged in source. Startup and backend identity require verification. | R0, R10, R11 |

Relevant files include `src/lib/bookmarks.ts`, `src/lib/db-backup.ts`, `src/lib/youtube.ts`, `src/lib/youtubeTranscript.ts`, `src/lib/llm.ts`, `src/lib/processing.ts`, import and enrichment routes, folder components and hooks, `src/app/hooks/useBookmarksList.ts`, and Settings hooks.

For YouTube metadata, distinguish the playlist item's addition date and channel from the video's publication date and uploader. Use the [YouTube playlistItems reference](https://developers.google.com/youtube/v3/docs/playlistItems).

## Apply the execution rules

Full implementation requires approval because the user requested review first. The user separately approved the original three calibration repairs and the six timed units listed in Latest calibration status. Their changes are isolated and verified; do not repeat them after integration. After full approval, proceed within the approved repair scope without requesting permission again for routine implementation choices.

Read repository instructions and applicable skills. Use an isolated worktree and test database. Preserve unrelated user edits. Do not run migrations or tests against the live desktop database. Back up real data before any later authorized migration.

Keep each step reviewable. Preserve documented agent requests and response fields. Use additive migrations and compatibility adapters when internal representations change. Validate external inputs and derive shared types from schemas.

Complete a step's success criteria before dependent work starts. Remove implementation work for defects already fixed in source. Do not replace working features merely to match a suggested design.

Do not merge to main, publish a desktop release, install an update into the user's app, delete user data, or reconnect accounts incidentally. Release publication is separate from implementation acceptance.

### Use subagents where necessary and convenient

The implementing AI is explicitly allowed to use subagents to speed up independent investigation, implementation, tests, and review after approval.

The primary AI owns design, integration, verification, and progress reports. Give each subagent its task ID, relevant findings, file ownership, shared contracts, and success criteria.

Use GPT-6.1 Sol at medium reasoning effort for the primary AI and implementation subagents. Set `model="gpt-6.1-sol"` and `reasoning_effort="medium"` when the delegation tool accepts those fields. Use the appropriate context-fork setting when required by the tool.

Assume one primary AI and up to three implementation subagents for scheduling. Use a separate reviewer when capacity permits. Do not create agents merely to fill available slots.

Assign one owner to Prisma schema changes, migrations, shared search contracts, job lifecycle, and dependencies. Avoid concurrent edits to the same files. Use separate worktrees when ownership overlaps, and separate databases and ports for parallel verification.

Agree on contracts before splitting backend and interface work. Inspect every contribution and verify integrated behavior. Do not estimate speed by dividing effort by agent count.

## Historical continuous AI execution schedule

Execution configuration: GPT-6.1 Sol, medium reasoning effort, one primary AI with up to three implementation subagents when useful. Run continuously, including nights and weekends. Do not apply human workday limits.

Let T0 be the actual implementation start after explicit approval. For a concrete dated example, use **October 2, 2026 at 15:00 Europe/Rome** as T0. This is a planning reference, not a scheduled launch. If approval arrives later, shift every date by the exact difference between the actual T0 and this reference. The task durations and dependencies remain unchanged.

The estimates below cover the remaining roadmap after the calibration repairs, including integration of their isolated changes. They are provisional elapsed hours of active autonomous delivery, including model calls, edits, tools, checks, integration, and corrective work. Task budgets remain sequential; useful delegation may finish independent work earlier, but no measured speed multiplier is applied. They are not cumulative agent-hours or human engineering hours.

Three GPT-6.1 Sol medium workers completed bounded calibration repairs in 109, 201, and 144 seconds, including focused checks. The integrated build and five real-SQLite checks passed. Baseline and final suites retain one unit failure, three browser-test failures, and a lint dependency crash. This partially calibrates the timing method at 3/5; it does not validate the whole-roadmap duration. R2 and R6 allowances were reduced because their scoped repairs are now implemented. Other task allowances and the contingency remain judgment estimates. Re-estimate after R0, R4, and R7. Details and raw timing locations are in `docs/execution-estimate-calibration.txt`.

Continuous execution assumes the machine and agent runner remain available, the runner supports continuation, model usage limits permit the work, and required local services stay accessible. This document does not enable unattended execution or guarantee that a single chat turn will run for the full schedule. Configure the execution mechanism only after approval.

### Separate active time from external waiting

Track these times independently:

- Active elapsed execution time, including tools and checks, as estimated below.
- External waiting time for user decisions, OAuth completion, unavailable endpoints, model usage resets, machine downtime, or other dependencies.
- Cumulative subagent effort, for reporting only. Do not add concurrent agent hours to elapsed time.

Use available independent work while an external dependency is pending. Add only waiting that blocks the remaining required work to the completion forecast. External waiting has no defensible fixed estimate before it occurs, and is excluded from the dates below. Report a blocker and revised forecast rather than claiming a fixed deadline still holds.

### Proposed dates and durations

The original 63.5-hour repair budget is superseded by a remaining-work budget of approximately 62 hours. R2 now has a 1-to-3-hour allowance, previously 2 to 4 hours. R6 now has a 0.75-to-2.5-hour allowance, previously 1 to 3 hours. These residual allowances are judgment revisions informed by completed work, not measured deductions or confidence intervals. Read completion dates to the nearest hour; minute-level entries only show the arithmetic.

| Step | Things to do | Active elapsed estimate | Scheduled budget | Start | Finish | Dependency |
|---|---|---|---|---|---|---|
| R0 | Confirm defects and baseline | 0.5 to 1.5 h | 1.5 h | Oct 2, 15:00 | Oct 2, 16:30 | Approval |
| R1 | Repair backup and restore safety | 1 to 3 h | 3 h | Oct 2, 16:30 | Oct 2, 19:30 | R0 |
| R2 | Finish search relevance, contract, and pagination | 1 to 3 h | 3 h | Oct 2, 19:30 | Oct 2, 22:30 | R1 |
| R3 | Repair index freshness and compatibility | 2 to 4 h | 4 h | Oct 2, 22:30 | Oct 3, 02:30 | R2 |
| R4 | Finish processing outcomes and recovery | 4 to 8 h | 8 h | Oct 3, 02:30 | Oct 3, 10:30 | R3 |
| R5 | Repair folder and import consistency | 2 to 5 h | 5 h | Oct 3, 10:30 | Oct 3, 15:30 | R4 |
| R6 | Finish YouTube backfill and unavailable items | 0.75 to 2.5 h | 2.5 h | Oct 3, 15:30 | Oct 3, 18:00 | R5 |
| R7 | Repair enrichment evidence and Ask | 4 to 8 h | 8 h | Oct 3, 18:00 | Oct 4, 02:00 | R6 |
| R8 | Repair Settings feedback and diagnostics | 1.5 to 3 h | 3 h | Oct 4, 02:00 | Oct 4, 05:00 | R7 |
| R9 | Repair library interactions | 1.5 to 3 h | 3 h | Oct 4, 05:00 | Oct 4, 08:00 | R8 |
| R10 | Repair metrics, desktop feedback, and Docs | 1 to 3 h | 3 h | Oct 4, 08:00 | Oct 4, 11:00 | R9 |
| R11 | Verify existing workflows and migrations | 3 to 6 h | 6 h | Oct 4, 11:00 | Oct 4, 17:00 | R10 |
| C1 | Resolve acceptance defects and contingency | Up to 12 h reserved | 12 h | Oct 4, 17:00 | Oct 5, 05:00 | R11 |
| N1 | Add notes and Markdown export if justified | 2 to 5 h | 5 h | Oct 5, 05:00 | Oct 5, 10:00 | Repair acceptance and addition approval |
| N2 | Verify additions and complete handoff | 1 to 2 h | 2 h | Oct 5, 10:00 | Oct 5, 12:00 | N1 |

All dates are in 2026 and all times are Europe/Rome. The dated schedule uses each step's upper estimate and sequential dependencies. Work inside a step may run in parallel. Finishing early moves later work forward.

The repair steps total **22.25 to 50 active elapsed hours**. Reserve up to another **12 hours** for acceptance defects. The proposed repair completion budget is **62 hours after T0**, giving a reference completion date of **October 5, 2026 at 05:00**. This is approximately 2 days and 14 hours of continuous execution, excluding blocking external waiting.

The first complete acceptance pass is budgeted to finish **October 4 at 17:00**, before contingency. Do not consume contingency unless needed, and do not reduce checks to fit the estimate.

Optional N1 and N2 add **3 to 7 active elapsed hours** only if approved after repair acceptance. With immediate addition approval, the upper scheduled total is **69 hours after T0**, giving a conditional reference completion date of **October 5, 2026 at 12:00**. If addition approval takes time, add that blocking wait. Broader additions are excluded.

Record actual start and finish timestamps for every step. Reforecast the remaining work using measured results. Preserve all success criteria if a step overruns, and report the new completion estimate instead of silently reducing scope.

## R0: Establish the current baseline

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

Subagents may inspect retrieval and processing independently while the primary AI establishes environment identity.

## R1: Protect data before migrations

What to do:

1. Replace raw active-file backup copies with a consistent SQLite snapshot supported by the adapter. Verify concurrent writes and WAL behavior using the [SQLite backup guidance](https://www.sqlite.org/backup.html).
2. Stage restore files. Check integrity, required tables, and schema compatibility before replacing the active database.
3. Block conflicting writes, create a recovery snapshot, replace safely, reconnect, and roll back on failure.
4. Prevent silent overwrite when a custom backup name already exists. Explain that desktop backups are local and may contain stored credentials and technical logs.
5. Preserve current confirmation dialogs. Keep clear and delete operations outside live automated verification.

Success criteria:

- A backup made during synthetic writes restores consistently and passes an integrity check.
- Corrupt or incompatible files leave the active database unchanged.
- Injected replacement or reconnect failures are recoverable.
- Restore cannot race active processing.
- Reusing a backup name preserves the earlier file or requires an explicit overwrite choice.

One owner implements database operations. A subagent may verify failures against separate disposable files.

## R2: Repair existing search

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

Subagents may implement feedback and regression cases after the query contract is agreed.

## R3: Repair indexing

What to do:

1. Store model identity, dimensions, indexed-content hash, and generation time through additive migrations.
2. Mark vectors stale after searchable content changes through the interface, enrichment, or agent API.
3. Retain the calibrated byte-view decoding repair. Add validation of dimensions, finite values, and nonzero magnitude.
4. Treat unknown legacy vectors as requiring verification or rebuild. Do not invent model identities.
5. Provide a controlled model-change rebuild with progress and keyword fallback.
6. Reject obsolete indexing results when the bookmark changed during generation.

Success criteria:

- Edits and appends cannot leave outdated vectors treated as current.
- Reindexing changes retrieval to reflect updated content.
- Incompatible or malformed vectors produce useful feedback without crashes or invalid comparisons.
- A concurrent edit prevents an obsolete vector from being accepted.
- Rebuild preserves bookmarks, folder relationships, and agent IDs.

One owner controls migrations and indexing. A subagent may verify malformed vectors and concurrent edits.

## R4: Repair processing and recovery

Calibration completed the embedding-sync total-failure outcome repair. Generic total failures now record Failed and return HTTP 502 with `ok: false`. Partial success and no-work behavior remain compatible. Persistent continuation, cancellation, recovery, and historical display repairs remain pending.

What to do:

1. Define honest outcomes for complete success, partial failure, total failure, cancellation, and work remaining. Separate preflight failures from item failures.
2. Persist server-owned continuation for enrichment and indexing. Integrate imports in R5.
3. Persist scope, settings snapshots, checkpoints, retry counts, and cancellation. Make submission idempotent.
4. Prevent duplicate work through database claims or leases. Recover interrupted operations at startup.
5. Retry transient failures within a budget. Stop configuration errors early and link to the relevant settings.
6. Make stop controls, event reconnection, and counters consistent across Dashboard, Folders, Processing, and single-item actions.
7. Correct historical outcome displays from trustworthy recorded counters without rewriting logs as successful.

Success criteria:

- An operation with zero successes and all attempts failed never shows Completed.
- Partial successes show both output and failures. Paused work is not called finished.
- Navigation does not end continuation. Restart permits safe recovery.
- Duplicate submissions and competing workers do not duplicate completed writes.
- Stop prevents new work and aborts active calls where supported.
- Preflight failures show the cause and repair action even with zero attempted items.
- Development and desktop startup do not accidentally create competing workers.

One owner controls lifecycle. Subagents may build controls and fault-injection cases after the contract is defined.

## R5: Repair folders and imports

What to do:

1. Link folder names and counts to the correctly scoped library.
2. Apply R4's lifecycle to X imports, Import all, YouTube playlist actions, and dashboard imports.
3. Preserve checkpoints and cap rules. Distinguish new, refreshed, skipped, and unavailable entries.
4. Verify assignment updates for existing items and preserve manual enrichment during refresh.
5. Explain whether each action syncs names, imports, summarizes, or indexes. Use consistent labels across sources.
6. Show local counts and activity dates. Retain source changes already implemented. Avoid window reloads that discard context.
7. Distinguish playlist entries from unique videos where duplicates exist. Preserve existing IDs and memberships. Defer canonical merging unless a confirmed defect requires it.

Success criteria:

- A folder opens exactly its local items, including a useful empty state.
- Repeated import creates no duplicate records and preserves human edits.
- A cap stop reports its reason and supports later continuation.
- Import all survives navigation and preserves progress when a folder fails.
- Conflicting operations do not corrupt progress.
- Count labels explain entries versus unique videos where those differ.

Subagents may implement folder navigation while the primary AI integrates import continuation.

## R6: Repair YouTube metadata

Calibration completed new-import uploader-title and publication-date mapping, including unknown-value handling. Raw playlist-addition metadata is preserved. Separate persisted addition time, uploader IDs, historical backfill, and unavailable-item handling remain pending.

What to do:

1. Map uploaders from `videoOwnerChannelTitle` and `videoOwnerChannelId`, with explicit handling for missing values.
2. Store playlist-addition time separately. Use `contentDetails.videoPublishedAt` or authoritative video metadata for Posted.
3. Backfill from stored raw data when possible. Bound quota-aware metadata fetches when needed.
4. Represent deleted, private, or unavailable items honestly. Retain useful prior captured content with an availability label.
5. Prevent unavailable or title-only items from receiving unsupported confident digests.

Success criteria:

- A mixed-uploader playlist shows the correct creator for each fixture.
- Publication and playlist-addition dates retain separate meanings.
- Missing authors remain unknown instead of becoming the playlist owner.
- Deleted placeholders do not receive fabricated fresh summaries.
- Repair preserves IDs, memberships, read state, and manual edits.

A subagent may verify fixtures while one owner implements mapping and backfill.

## R7: Repair enrichment and Ask

What to do:

1. Share extraction between single and bulk processing. Clear obsolete failure state after a successful retry.
2. Extract article bodies with bounded size, redirects, and timeouts. Validate protocols and public-web destinations.
3. Store capture method, completeness, language, timestamps, and failure reasons separately from generated summaries.
4. Process long material in bounded sections instead of silent truncation. Retain transcript timestamps when available.
5. Give Ask useful evidence within its context budget. Include exact keyword candidates when semantic retrieval misses them.
6. Validate citation IDs against supplied evidence. Show supporting excerpts and video timestamps. Decline unsupported answers.
7. Preserve human corrections during ordinary reprocessing. Offer an explicit replace option and record generation provenance.
8. Preserve the target-language setting's documented translation meaning. Make summary-language behavior explicit without silently expanding that setting's scope.

Success criteria:

- Single and bulk routes produce equivalent capture states for the same source.
- A fact near the end of a long fixture can support a summary or answer.
- Description-only and partial-source digests disclose their limitations.
- Citations resolve to evidence supplied to the model. Unsupported questions produce insufficient-evidence responses.
- Reprocessing preserves human corrections by default and clears stale errors on success.
- Missing captions produce a fallback instead of failing the whole operation.

Subagents may implement article extraction, transcript handling, and evidence display after the capture contract is agreed. The primary AI integrates Ask and context budgets.

## R8: Repair Settings

What to do:

1. Distinguish configured, tested, disconnected, expired, and unavailable states.
2. Add separate small chat and embedding tests using the displayed draft values consistently.
3. Verify save feedback, dirty-state handling, presets, tab changes, and numeric validation.
4. Correct batch help to describe items per operation batch. Separate it from response tokens and concurrency.
5. Verify OAuth expiry, refresh, callbacks, cancellation, and disconnect in isolated cases. Keep source fixes already present.
6. Explain local, LAN, and remote destinations, sent content, and technical-log storage. Keep secrets masked in diagnostics.

Success criteria:

- A saved model name is not presented as verified connectivity.
- Broken embeddings with working chat do not appear fully ready for semantic search.
- Tests use the values shown. Draft changes are preserved or users receive a clear choice before losing them.
- Invalid numbers cannot start malformed operations.
- OAuth failures preserve stored data and provide a concrete recovery action.
- Save success or failure is visible and unambiguous.

Subagents may verify connection states and form interactions independently.

## R9: Repair library interactions

What to do:

1. Add filters for existing unread, failed, blocked, stale-index, and unindexed states. Share predicates with dashboard counts.
2. Display read, edited, and processing states independently so an edit cannot hide a failure.
3. Improve the existing inspector for narrow windows without forcing the wide metadata table into the reading area.
4. Verify edit, read toggle, reprocess, translation, and close actions. Reject stale responses after selection changes.
5. Preserve filter and sort context. Provide accessible names, predictable keyboard focus, appropriate Escape dismissal, and retry feedback.

Success criteria:

- State-filter results agree with corresponding counts.
- Translation for item A never appears in item B after rapid selection changes.
- Failed actions preserve the last valid data and offer a retry.
- Keyboard users can open and close readers and dialogs with predictable focus.
- Existing reading actions work at 900-pixel desktop width. Verify responsive behavior at 390 pixels.

Subagents may repair layout and action races in separate files. Bulk actions and a new review queue remain deferred.

## R10: Repair Dashboard, desktop feedback, and Docs

What to do:

1. State semantic coverage's denominator. Separate library coverage, pending enrichment, missing vectors, and stale or incompatible vectors.
2. Link dashboard counts to matching scoped views.
3. Use source-specific last-sync information. Separate local import limits from provider quotas and LLM usage.
4. Show app version and useful backend identity. Expose update-check failure and retry feedback. Do not install an update during verification.
5. Use a neutral indicator for normal processing and reserve alerts for failures.
6. Update Docs, README, developer instructions, and API examples. Correct source-toggle instructions, privacy language, folder actions, outcomes, and backup terminology.

Success criteria:

- No percentage implies full-library semantic coverage while stored items are excluded.
- Metric links open matching scope and reconcile with documented counts.
- X and YouTube last-sync information cannot be confused.
- A simulated unavailable updater shows useful status without blocking startup.
- All seven panes have accurate instructions. Agent examples match the delivered API.

Dashboard and Docs may use separate subagents after metric definitions are settled. The primary AI verifies desktop behavior.

## R11 and C1: Accept the repaired application

What to do:

1. Run `npm run lint`, `npm run test`, `npm run test:e2e`, and `npm run build`. Resolve regressions and distinguish unrelated baseline failures.
2. Exercise import, enrich, index, filter, read, edit, translate, folder processing, settings, and documentation navigation using isolated data.
3. Verify interruption, resume, provider errors, cancellation, event reconnection, and duplicate requests.
4. Migrate a copy of a pre-change database. Check bookmarks, memberships, settings, read state, manual edits, logs, and agent IDs.
5. Back up and restore migrated fixtures. Verify desktop startup and workers using repository build procedures.
6. Measure a fixed search-query set and documented library sizes. Separate embedding-provider latency from local ranking time. Report known-item recall among the first five results and remaining failures.
7. Use C1 only for acceptance defects and contingency. Do not fill unused time with unapproved features.

Success criteria:

- Each confirmed finding has passing evidence or an explicitly approved deferral.
- All seven panes pass their workflow checks. Subagent assertions do not substitute for verification.
- Migration and restoration preserve user-owned data.
- Fixtures expose no duplicate workers, permanently stranded operations, or false total-failure successes.
- Search scope and freshness checks pass deterministically. Measurements disclose remaining quality and latency limitations.
- Handoff includes changed files, workflow screenshots, check results, migration notes, and outstanding issues.

Subagents may verify independent journeys and compatibility. The primary AI owns acceptance.

If a required live endpoint is unavailable, finish isolated work and record the outstanding check. Reforecast the final date if it blocks acceptance. Do not call incomplete acceptance complete.

## N1 and N2: Add only justified features

After repair acceptance, review a real journey: find saved material and turn it into a reusable research note. If the existing agent API already meets that need with acceptable effort, stop at the repair milestone.

If the user approves additions, implement only these capabilities in N1:

1. Store personal notes separately from original content and generated summaries. Preserve notes during reprocessing. Expose an additive agent API field. Do not send notes to remote AI by default.
2. Export selected bookmarks as a portable Markdown bundle with stable identifiers, source links, summaries, tags, notes, and evidence links. Use predictable filenames. Exclude credentials and raw technical logs.

Run integration checks and complete handoff in N2.

Success criteria:

- Notes survive reprocessing, migration, backup, and restore.
- Export contains exactly the selected items and is readable outside XBook.
- Repeated export uses predictable identifiers without multiplying records inside XBook.
- Export contains no credentials or unrelated data.
- Existing library actions and agent consumers continue to work.

Notes and export can use separate subagents once the data contract is defined. The primary AI integrates and verifies them. Direct Obsidian vault writes are excluded from this estimate.

## Keep broader additions outside the dated scope

Defer project collections, bulk actions, saved searches, a review queue, scheduled digests, manual URL capture, related bookmarks, a full onboarding wizard, cloud synchronization, new connectors, a browser extension, and a native mobile app.

Propose an addition only when a completed repair journey demonstrates its need. Give it a separate scope, success criteria, estimate, and approval before assigning dates. Neither October reference completion date includes this backlog.

Do not introduce a vector database or replace the framework without measurements showing that the current architecture cannot meet the repaired requirements.

## Report progress and schedule changes

Maintain a status record containing task ID, finding IDs, state, changed files, acceptance evidence, actual effort, and revised finish date. Update it after each completed step.

Report material schedule changes when discovered. Distinguish estimates from actual time. Do not present overlapping subagent hours as elapsed calendar time.

Before schema changes, record compatibility and recovery requirements. Before interface changes, define the behavior being repaired. Before closing a task, verify that behavior through the API or interface.

## Use this AI handoff after approval

> Implement the approved repair-first plan using the remaining acceptance units in `docs/estimate-model/tasks.json` and the success criteria in this document. Integrate the nine accepted isolated calibration repairs without repeating them. Follow dependency and file ownership rules, accept restore before migrations, and unlock dependent work only after independent acceptance. You may use subagents where necessary and convenient. Use verified GPT-6.1 Sol medium for coordinator and subagents, with up to three implementation workers and one coordinator/reviewer. Use isolated worktrees, disposable databases and ports; preserve existing data and agent compatibility. Execute continuously only while the runner and usage limits support continuation. Freeze per-unit and batch forecasts before work; record parent dispatch, worker start, independent acceptance, corrections, queue/review waits and blocking external waits. The current warm base planning target is about 10 hours after approved T0, with roughly 5-to-23-hour judgment scenarios and a named 25-hour stress scenario. Those figures are unvalidated assumptions. Reforecast after restore, startup continuation and long-source acceptance. Retain required checks until passed or explicitly deferred by the user. Do not start notes/export without separate approval after repair acceptance. Do not merge, publish a desktop release, install updates, change the live database or process the whole private library without authorization. Begin full implementation only after explicit approval.
