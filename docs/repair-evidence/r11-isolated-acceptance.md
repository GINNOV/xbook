# R11 T3/T5 isolated acceptance

## Historical migration and restore

The generated pre-change fixture stops at `20260817000000_folder_last_activity`: **27 migrations**, before embedding freshness, metadata/capture/provenance, embedding identity, and durable job fields. It contains synthetic X bookmarks and duplicate YouTube video entries in two distinct playlists, folder membership/activity dates, manually corrected summaries/categories/tags, read/edit dates, a legacy embedding blob, media data, OAuth/settings configuration, usage, historical imports, an agent operation with fixed selected bookmark IDs, processing events, and LLM logs.

The migration acceptance creates a separate actual SQLite file copy and invokes the current Prisma CLI `migrate deploy` against that copy. Current history is **31 migrations**. Every existing column in all nine application tables is compared before/after, with integrity and foreign-key checks. The original pre-change file bytes remain unchanged.

Two integration journeys passed:

1. Deploy all current migrations to the copied historical file; create an online backup; mutate human summary/read/folder/settings and delete logs/events; restore the backup through integrated maintenance; compare all original columns and verify a guarded write succeeds after reconnect.
2. Start with a current empty deployment; restore the untouched historical original through staged validation/migration; compare all original columns, stable agent/bookmark IDs, and separate playlist memberships. New provenance/job/index identity fields remain honestly absent rather than fabricating historical values.

Focused integrated run: **3 files, 28 tests passed**, including the existing process crash, ownership fencing, corruption/schema rejection, restore, and packaged startup recovery suites. This evidence covers fixture migration/restoration. Root owns the full desktop Rust/build/runtime acceptance.

```sh
PATH=/Users/joseph/.npm/_npx/387698761821791d/node_modules/.bin:$PATH npx vitest run tests/unit/migration-preservation-acceptance.test.ts tests/unit/database-restore.test.ts tests/unit/desktop-database-startup.test.ts
```

## Fixed SQLite search benchmark

Each size contains exactly 100, 1,000, or 10,000 synthetic bookmarks in a current migrated SQLite database. The benchmark calls production `getBookmarks` and its normal Prisma retrieval and OpenAI embedding client. A local HTTP provider supplies **768-dimensional** deterministic embeddings, honors the SDK's requested base64 format, and deliberately waits 20 ms. Real endpoint/client response latency is measured around `generateEmbeddingResult`; local retrieval time is total request duration minus that measured generation duration.

The same eleven known-item queries run at every size: seven semantic queries (six scoped plus one full-library ranking), whole-word `rareterm`, Unicode phrase `NAÏVE BAYES`, punctuation phrase `A/B test alpha`, and substring `C++`. One additional request per size deliberately receives provider HTTP 503 and verifies explicit whole-word fallback with the same known item. Source, category, folder, unread, summarized, and video scopes are exercised. Sixty-five stronger other-source/folder candidates cannot crowd scoped hits out. Stale content hashes, malformed blob length, NaN values, a different model, and missing legacy provenance cannot enter usable semantic results.

All **33 fixed queries plus 3 offline fallback cases** returned their known item among the first five results. There were no known-item misses in this controlled set. Remaining quality limits are below.

| Bookmarks | Fixed top-five recall | Offline fallback | HTTP generation median ms | Scoped local median ms | Full-library local ms | Exact local median ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 11/11 | 1/1 | 23.15 | 2.73 | 13.06 | 3.41 |
| 1,000 | 11/11 | 1/1 | 22.99 | 1.79 | 76.78 | 1.19 |
| 10,000 | 11/11 | 1/1 | 23.16 | 16.86 | 535.88 | 19.39 |

Raw per-query timings, returned IDs, runtime, dimensions, and fixture details: [r11-search-benchmark.json](r11-search-benchmark.json).

```sh
XBOOK_BENCHMARK_OUTPUT=docs/repair-evidence/r11-search-benchmark.json PATH=/Users/joseph/.npm/_npx/387698761821791d/node_modules/.bin:$PATH npx vitest run tests/unit/search-benchmark-acceptance.test.ts
npx eslint tests/fixtures/migrated-database.ts tests/unit/migration-preservation-acceptance.test.ts tests/unit/search-benchmark-acceptance.test.ts
npx tsc --noEmit
```

The benchmark passed **3 tests**. Focused lint and full TypeScript validation passed.

These timings are one local macOS/arm64 Node 24 run, with medians across different fixed queries rather than repeated performance trials. The full-library query decodes and ranks the entire candidate set; scoped measurements include scope filtering/SQL, selected-vector ranking, and result hydration. Generation time includes configuration lookup, SDK transport, HTTP delay, response decode, and vector validation. It does not measure a real model's inference latency. Deterministic known-item vectors validate retrieval plumbing, scope, freshness, and fallback behavior; they do **not** establish live model semantic quality, a calibrated relevance threshold, or production latency guarantees. Library descriptions and vector dimensions are controlled fixtures; no real account, live endpoint, primary checkout, or application database was used.
