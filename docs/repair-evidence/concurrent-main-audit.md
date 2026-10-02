# Concurrent main audit: PR #60 and issues #19–59

Audit date: 2026-10-02. Exact default-branch merge: `e631dd49e5340d4bc4e0ebfe6ec5bdf2b2c7dbac`; PR head: `83a6565ebfb0584618c599e27b70186adf165927`. Source inspected read-only from an archive of that merge, not the live database or installed app. No code, branch, database or GitHub issue state was changed.

## Evidence boundary

Read [PR #60](https://github.com/GINNOV/xbook/pull/60), its body and both issue/review comment collections, plus **every full body and comment collection for issues #19–59** using `gh api`. All 41 issue comment collections and both PR comment collections were empty. JSON records each issue's full active acceptance section and body SHA-256. Superseded combined reports retained in issue details are historical; the scoped acceptance sections below are the active requirements.

The PR reports 263 passing tests across 40 files and a compiled/typechecked webpack build. It also reports lint exiting 1 with eight React hook errors, a Turbopack panic due to symlinked dependencies, and **Playwright not run**. These are reported results, not independent reruns in this audit. Thus closure of #7–29 cannot establish completion of all plan acceptance. #30–59 remain open. #1/#3 were already resolved through PR #4/#5 and their confirmed resolution comments; #30 overlaps #1's snapshot requirement, while #31's local-name collision is distinct from #3's download filename. #2 was closed externally and remains outside scope; no Windows acceptance or desktop release is inferred.

## Full scoped mapping

“Core present” means source inspection found the principal repair; it does not mark an issue accepted. “Defect remains” identifies a surviving implementation gap. “Partial” retains unfulfilled criteria or workflows that still need verification.

| Issue / state | Existing owner and units | PR #60 assessment / evidence and remaining acceptance |
|---|---|---|
| [#19](https://github.com/GINNOV/xbook/issues/19) closed | R1; D1 / D4 / D2 / D3 | **defect remains**. restore-safety.ts validates only Bookmark/Settings and optional migration names; no writer fence, staged upgrade, complete schema validation or crash-safe prepared recovery. |
| [#20](https://github.com/GINNOV/xbook/issues/20) closed | R2 + R7; Q1 / Q2 / E5 | **partial**. bookmarks.ts filters before ranking and Ask scopes source; shared library/agent contract and complete workflow acceptance still require verification. |
| [#21](https://github.com/GINNOV/xbook/issues/21) closed | R3; M1 / M3 | **partial**. embedding-index.ts invalidates edited content and guards obsolete writes; full identity and migrated preservation acceptance remain. |
| [#22](https://github.com/GINNOV/xbook/issues/22) closed | R4; P1 / P4 / P5 | **partial**. processing.ts and operation routes improve total-failure/paused outcomes; preflight repair actions, history and every UI surface still require acceptance. |
| [#23](https://github.com/GINNOV/xbook/issues/23) closed | R5; F1 / F2 / F3 / F4 | **partial**. Folder links are present; durable imports, entries versus unique counts and preservation acceptance remain. |
| [#24](https://github.com/GINNOV/xbook/issues/24) closed | R6; Y1 / Y2 | **partial**. youtube-metadata.ts uses videoOwnerChannelTitle/Id for new imports; repeatable historical backfill and quota/checkpoint acceptance remain. |
| [#25](https://github.com/GINNOV/xbook/issues/25) closed | R7; E1 / E2 / E3 / E4 | **partial**. article-extract.ts retains beginning/end within a bound; it does not process all long-source sections and can omit middle facts. |
| [#26](https://github.com/GINNOV/xbook/issues/26) closed | R8; S1 / S2 / S3 | **defect remains**. Settings model chips distinguish configured from tested and embedding test exists; credential presence still implies connector connected, and draft test fallbacks remain. |
| [#27](https://github.com/GINNOV/xbook/issues/27) closed | R9 + R2; L1 / L2 / L3 / Q1 | **partial**. State filters were added; count agreement, independent badges, stale-response fencing and keyboard/narrow workflows remain. |
| [#28](https://github.com/GINNOV/xbook/issues/28) closed | R10 + R3; H1 / M2 | **defect remains**. Coverage denominator is all saved items, but dashboard-fetcher.ts counts raw non-null vectors without current identity/validity. |
| [#29](https://github.com/GINNOV/xbook/issues/29) closed | R10; H3 | **partial**. Docs source-selector wording corrected; all seven panes, outcomes, backup and agent examples still need behavioral acceptance. |
| [#30](https://github.com/GINNOV/xbook/issues/30) open | R1; R1.1 | **core present; acceptance pending**. db-backup.ts uses online SQLite snapshots; overlaps prior issue #1 / PR #4. Concurrent WAL/download compatibility must remain covered during integration. |
| [#31](https://github.com/GINNOV/xbook/issues/31) open | R1; R1.4 | **core present; acceptance pending**. db-backup.ts uses exclusive name creation and returns 409 on collision; custom local-backup collision differs from prior issue #3 download naming / PR #5. |
| [#32](https://github.com/GINNOV/xbook/issues/32) open | R2; R2.3 | **core present; acceptance pending**. bookmarks.ts defaults semantic results to relevance and exposes alternatives/cap help; preserve filtered pagination regression checks. |
| [#33](https://github.com/GINNOV/xbook/issues/33) open | R2; R2.4 | **core present; acceptance pending**. Effective page is normalized before fetching; boundary/fractional/empty-result acceptance must be retained. |
| [#34](https://github.com/GINNOV/xbook/issues/34) open | R3 + R2; M2 | **core present; acceptance pending**. embedding-vectors.ts decodes byte views and validates finite nonzero vectors and dimensions; retain malformed-vector/keyword fallback regression checks. |
| [#35](https://github.com/GINNOV/xbook/issues/35) open | R3; M1 / M2 / M3 | **defect remains**. PR body explicitly permits null-model legacy vectors to rank. Unknown identity is not verified; model/dimension alone omit endpoint identity. |
| [#36](https://github.com/GINNOV/xbook/issues/36) open | R4 + R5; P2 / P3 / F3 | **defect remains**. work-continuation.ts startup selects paused/queued, excluding running; imports remain browser-owned. Process-local scheduling does not provide durable worker fencing. |
| [#37](https://github.com/GINNOV/xbook/issues/37) open | R4 + R5; P2 / P3 / F3 | **defect remains**. Enrichment checks for an active run then creates separately; concurrent submissions lack atomic durable claims/leases. |
| [#38](https://github.com/GINNOV/xbook/issues/38) open | R4 + R5; P4 / P5 / F3 | **partial**. Embedding continuation checks run status, but single-item commits and all import/capture/provider paths need durable cancellation fencing and event reconstruction. |
| [#39](https://github.com/GINNOV/xbook/issues/39) open | R5; F4 | **defect remains**. useFoldersPanel.ts still calls window.location.reload after X sync; YouTube refresh alone does not preserve both-source context. |
| [#40](https://github.com/GINNOV/xbook/issues/40) open | R6; Y1 / Y2 | **partial**. New YouTube imports persist publication versus playlist addition; repeatable historical backfill and user-data preservation remain. |
| [#41](https://github.com/GINNOV/xbook/issues/41) open | R6 + R7; Y1 / Y3 / E1 | **defect remains**. youtube-metadata.ts blocks unavailable videos without transcripts, but available title-only rows can still qualify for confident digestion. |
| [#42](https://github.com/GINNOV/xbook/issues/42) open | R7 + R6; E1 / E4 / Y3 | **partial**. Article captureJson and YouTube evidence retain some capture details; complete provenance/timestamps/reasons and inspector partial-source disclosure remain. |
| [#43](https://github.com/GINNOV/xbook/issues/43) open | R7; E5 / E6 | **defect remains**. Ask includes YouTube evidence, but article captureJson is omitted; keyword candidates appended after semantic candidates can be cut by slice(0,12). |
| [#44](https://github.com/GINNOV/xbook/issues/44) open | R7; E3 | **core present; acceptance pending**. saveEnrichmentIfUnchanged clears obsolete error/failure state after success; single/bulk failure and retry workflow acceptance remains. |
| [#45](https://github.com/GINNOV/xbook/issues/45) open | R7 + R5; E0 / F2 | **partial**. Human corrections are protected by backend guards, replace=true and summarySource; explicit UI replacement choice and repeated-import acceptance remain. |
| [#46](https://github.com/GINNOV/xbook/issues/46) open | R7; E2 | **defect remains**. article-extract.ts rejects literal private/local hosts but does not resolve/pin DNS destinations, including redirects; domains resolving privately bypass the guard. |
| [#47](https://github.com/GINNOV/xbook/issues/47) open | R7; E2 / E3 / E4 | **defect remains**. Reader loop can accept a chunk past 200000 bytes; no-body arrayBuffer is unbounded. Network truncation can be reported complete, and section processing is absent. |
| [#48](https://github.com/GINNOV/xbook/issues/48) open | R8; S1 / S2 | **defect remains**. settings/test uses draft || saved fallbacks for chat model/base URL and saved YouTube auth; intentionally blank displayed values can test different saved values. |
| [#49](https://github.com/GINNOV/xbook/issues/49) open | R8 + R10; R8.4 / H3 | **core present; acceptance pending**. UsageSettings describes bookmarks per operation batch separately from tokens/concurrency; cross-pane Docs consistency still needs acceptance. |
| [#50](https://github.com/GINNOV/xbook/issues/50) open | R8 + R2, R4; S2 / Q1 / P1 | **defect remains**. Operation limits still use Math.max(1, Number(limitParam)); NaN, Infinity and fractional values are not rejected through one validated contract before run/provider work. |
| [#51](https://github.com/GINNOV/xbook/issues/51) open | R9; L2 | **defect remains**. Badge expression still prefers edited over failure, so an edited bookmark can hide failed processing. |
| [#52](https://github.com/GINNOV/xbook/issues/52) open | R9; L3 | **defect remains**. Translation updates after await without selection fencing; reprocess calls setSelectedId(id), allowing late completion to reopen/change the reader. |
| [#53](https://github.com/GINNOV/xbook/issues/53) open | R9 + R3; L3 / M1 | **core present; acceptance pending**. useBookmarksList.ts now sends bookmarkId: editing.id and route invalidates indexing; selected-only refresh/error/retry acceptance remains. |
| [#54](https://github.com/GINNOV/xbook/issues/54) open | R9; L3 | **defect remains**. InspectorHeader/edit dialog still lack accessible close/dialog naming, focus restoration and Escape handling; 900/390px workflows unverified. |
| [#55](https://github.com/GINNOV/xbook/issues/55) open | R10 + R6; H1 | **defect remains**. dashboard-fetcher.ts still takes global latest ImportRun without source identity; source-specific last-sync cannot be derived honestly. |
| [#56](https://github.com/GINNOV/xbook/issues/56) open | R10 + R0, R11; H2 / B0 / T4 | **partial**. Updater failure/retry and /api/version are added; installed backend reuse/identity and packaged isolated startup acceptance remain. Desktop packaging hardcodes the Node path, and bootstrap overrides the database URL. |
| [#57](https://github.com/GINNOV/xbook/issues/57) open | R10; H1 | **partial**. Both navigation paths use neutral animate-processing; active boolean alone does not implement distinct failure indication. |
| [#58](https://github.com/GINNOV/xbook/issues/58) open | R10 + R8; H3 / S2 | **core present; acceptance pending**. README now describes remote model content transmission and sensitive backups/logs; actual diagnostic masking and all destination help still need acceptance. |
| [#59](https://github.com/GINNOV/xbook/issues/59) open | R0 + R10, R11; R0.5 / H3 / T2 | **core present; acceptance pending**. AGENTS now documents Vitest/Playwright and disposable migrated SQLite plus Node24; provider avoidance and baseline-failure reporting still need complete verification instructions. |

## R1 comparison: default branch versus verified isolated replacement

All PR #60 paths below are relative to its exact merge. The isolated replacement was accepted with 18 restore tests, true child-process crash cases, HTTP/browser restores and packaged startup tests; its final integration still needs root review against the concurrent main changes.

| Required behavior | PR #60 source evidence | Verified isolated R1 implementation |
|---|---|---|
| Consistent backup / collision handling | `db-backup.ts` online snapshot and collision 409 present. | Retains these and prior PR #4/#5 export behavior. |
| Candidate compatibility | `restore-safety.ts` checks SQLite integrity, two table names and optional migration-name membership; accepts absent history. | Independent stage snapshot, integrity/FK checks, contiguous completed checksummed migrations, full table/index/trigger/view SQL fingerprint and stage-only upgrades. |
| Writer/transaction exclusion | `.maintenance.lock` PID file serializes restores only; `db.ts` Prisma queries do not participate. | SQLite ownership sidecar fences every Prisma query and whole transaction across processes; restore owns exclusive maintenance. |
| Active operations | Checks queued/running OperationRun only. | Also rejects unfinished ImportRun before swapping. |
| Crash during replacement | Prepared journal is not rolled back. Removal/rename occurs before journal becomes replaced, leaving a crash window; no directory fsync. | Durable journal and snapshot with fsynced directory transitions and process-kill recovery tests. |
| Startup ordering | `start-server.js` migrates before importing `db.ts`; `db.ts` catches recovery failure and continues without ownership. | The same compiled maintenance module recovers before migration and holds ownership through migration; safe first-launch creation afterward. |
| Stale clients after committed restore | No durable generation fence; another process can retain old SQLite connection. | Fsynced generation file forces disconnect/reconnect; tested kill after committed journal removal before ownership transaction commit. |
| Reconnection/rollback verification | `$connect` only; catch-path reconnect errors swallowed. Two tests use mock Prisma and minimal two-table fixtures. | Actual guarded Prisma reads/writes and preserved rows/relationships after injected reconnect failures, competing process and actual crashes. |
| Candidate source / path safety | Direct validation then raw copy; candidate can change and live WAL is not captured into an independent stage. | Immutable staged SQLite snapshot and traversal/symlink rejection before maintenance. |

## Acceptance actions retained for root

Keep all existing plan units and attach these scoped issues to their owners. Review actual delivered behavior before deciding whether externally closed umbrella/scoped issues should be reopened; this audit makes no GitHub state changes. In particular #19/#8 remain unsafe on main despite closure, #35–38 retain index/worker safety gaps, #41/#43/#46/#47 retain source-evidence gaps, and #48/#50–52/#54/#55 retain settings/reader/metric defects. Preserve useful PR #60 repairs when integrating verified work. R11 remains pending until independent lint, unit, E2E, production and isolated desktop workflow checks pass or an explicitly approved deferral is recorded.
