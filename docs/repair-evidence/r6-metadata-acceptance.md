# R6 metadata mapping and historical repair

2026-10-02. Isolated complete-repairs worktree; no live database, account mutation or live provider calls. Root independently accepted the initial 16-test Y1/Y2 foundation. The expanded reachable action below still requires root final acceptance; its two mounted Chromium cases passed in the UI owner’s disposable R5 browser batch.

## Delivered behavior

The existing main `youtube-metadata.ts` mapper is extended rather than duplicated. Playlist-owner fields never substitute for uploader fields, and playlist-addition time never substitutes for video publication. Validated raw parsing permits historical repairs without credentials or quota. Unknown facts become null; corrupt raw remains intact.

`youtube-metadata-backfill.ts` provides a resumable, idempotent repair. It updates only author identity, publication/addition dates, availability and an appended authoritative raw metadata cache. It preserves bookmark IDs, folder memberships, read state, human summaries/categories/tags, edit dates, captureJson, summary provenance and existing raw capture. Duplicate video IDs share one request across database pages; missing provider items are unavailable, without pretending to know whether they were deleted or private. Known private/deleted placeholders retain their specific label and prior useful capture.

`POST /api/youtube/metadata/repair` accepts `afterId`, integer `maxItems` of 1–50, `maxRequests` of 0–1, and `refresh` of missing/all. It defaults to raw-only repair. Auth is acquired only for an actual requested missing metadata batch. Provider calls happen outside database write transactions. Before every commit the endpoint takes a SQLite write lock and rejects queued/running/paused operations or unfinished imports. Raw compare-and-swap prevents an in-flight metadata response from overwriting newly captured or imported data. Abort is checked before and after writes within the transaction.

The mounted `YouTubeMetadataRepair` control offers raw repair, explicit opt-in to one metadata request per batch, an authoritative refresh, a visible last-committed cursor and explicit Continue. Quota stops do not retry automatically. Reopening the page can safely start again; cached results avoid recharging missing-fact requests. This is a bounded user action, not an autonomous R4 job.

The provider uses the official [videos.list contract](https://developers.google.com/youtube/v3/docs/videos/list), one quota unit per request with at most 50 distinct IDs, and [video snippet fields](https://developers.google.com/youtube/v3/docs/videos) for the authoritative uploader and publication date. The request timeout is ten seconds; cancellation propagates to fetch. No real Google request was used in verification.

## Verification

With Node 24:

```sh
PATH=/Users/joseph/.npm/_npx/387698761821791d/node_modules/.bin:$PATH npx vitest run tests/unit/youtube-metadata-backfill.test.ts tests/unit/YouTubeMetadataRepair.test.tsx
PATH=/Users/joseph/.npm/_npx/387698761821791d/node_modules/.bin:$PATH npx eslint src/lib/youtube-metadata.ts src/lib/youtube-metadata-backfill.ts src/lib/youtube-metadata-api.ts src/app/api/youtube/metadata/repair/route.ts src/app/components/YouTubeMetadataRepair.tsx tests/unit/youtube-metadata-backfill.test.ts tests/unit/YouTubeMetadataRepair.test.tsx
```

27 tests pass across two files. Every backend test creates a temporary SQLite database, executes current repository migrations and uses actual Prisma. A local HTTP provider fixture verifies the videos URL/ID batch/auth contract and HTTP 403 quota handling. Fixtures cover mixed uploaders; distinct dates; repeated repairs; unknown/malformed metadata; duplicated video IDs; quota/item/request stops and resume; missing/private/deleted videos; preservation; an intervening capture/import; aborted provider completion; active-operation conflicts before and after provider calls; unfinished legacy imports; and raw-only repair without credentials. UI checks verify explicit continuation cursors, retained authoritative refresh intent, request opt-in and actionable error retry.

Focused lint passes. A repeat including the existing main repair-behaviors tests passed 32 checks across three files. Full `npx tsc --noEmit` passes after the concurrent R7 sourceSections contract landed.

## Remaining acceptance

Root must rerun the final focused checks independently and verify the mounted action in a running disposable app. Two added Playwright cases cover raw-only repair through 55 synthetic rows, explicit continuation, repeat stability, preserved data and active-operation rejection. Both passed in the UI owner’s R5 browser batch against a disposable migrated database. Screenshot: `docs/repair-evidence/r6-metadata-repair.png`. The shared server was stopped afterward. Lifecycle owner must retain mapper fields through import/refresh and preserve raw source evidence/cache. R7 must enforce unavailable/title-only digest eligibility in the active capture/enrichment path and disclose prior capture limitations. Overall R6 and issue #41 are not marked complete by this helper/API evidence alone. Folder count/filter reconciliation belongs to R5 and is not inferred from metadata preservation.
