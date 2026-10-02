# R9 library interactions acceptance

Verified 2026-10-02 in the complete-repairs worktree against an automatically migrated disposable SQLite database and a local synthetic HTTP provider. No live accounts, provider calls, or local library data were used.

## Behavior

- Translation belongs to both bookmark ID and selection generation. A → B → A cannot adopt the old A response. Selection change aborts the observation; generation guards also reject late responses from providers that ignore cancellation. A failed retry retains the last valid translation and offers Retry inside the reader.
- Read responses merge only read state. Edit responses merge only editable enrichment fields and respect editor sessions; saving A cannot close B's editor. A newer human save fences a late generated response. Response IDs and payload shapes are validated before local changes.
- Reprocessing uses the durable single-item observer. Failure offers Retry; checkpointed failures resume the original run. Human edits remain protected until explicit Replace human correction confirmation. Read, edited, and processing state remain independent.
- Reader title buttons support keyboard activation. Escape closes the reader and restores the initiating row's focus. The edit dialog labels its fields, focuses Summary, traps keyboard focus, supports Escape, preserves failed drafts, and restores its opener. At 390 and 900 px the reader is a bounded scrollable drawer. The table scrolls within its container instead of expanding the page.
- Current human corrections and validated generated provenance are labeled separately. Capture method/status/reason and retained timed passages remain readable. Rows disclose partial source, description-only generation, or unavailable video separately from read/edit/failure badges.
- Ask responses and citations are validated. Query/source/mode changes abort stale observation. Failed questions retain the last valid answer with its original question label and offer Retry question.

## Verification

`npx vitest run tests/unit/useBookmarksList.test.ts`: 12/12 passed. The six regression additions exercise selection generations, last-valid translation/retry, late read versus edit, A save versus B editor, malformed response ID, and late generated fetch versus human save. Existing single-item observer tests remain.

`npx playwright test tests/e2e/library-interactions.spec.ts tests/e2e/dashboard-health.spec.ts tests/e2e/docs-navigation.spec.ts --reporter=line`: 6/6 passed (18.9 s).

Browser assertions include:

1. 390 px reader/editor activation, independent Blocked/Read/Human correction state, draft cancellation, Escape, focus restoration and preserved sort query.
2. The same flow at 900 px, bounded drawer width and no page errors.
3. Actual local HTTP single-item enrichment, saved model-qualified nonnull vector, translation failure retaining valid text and subsequent Retry, actual Ask answer with exact saved-source quote, and a retained partial transcript timestamp link to 2:03.
4. Actual dashboard Process inbox submission returning 202, durable completed checkpoint, one chat completion and one embedding request for the imported item, saved embedding model and captured post evidence. The summarize phase does not create a duplicate embedding.
5. Root dashboard health source/state links and backend identity fixture.
6. Seven linked guides and their Settings recovery links.

Owned production TypeScript checks and ESLint passed. Logs: r9-library-unit.log, r9-library-e2e.log, r9-library-lint.log. Screenshots: r9-reader-390.png and r9-reader-900.png.

The local provider uses exact route dispatch and base64 float embeddings, matching the OpenAI SDK default response encoding. Earlier fixture attempts used a broad translation substring that also matched the summarizer's English-language instruction, then counted unrelated provider routes as chat completions. Those fixture defects were corrected before the passing run; no production retry or acceptance assertions were weakened.

## Limits

The deterministic delayed-response cases use hook-level HTTP fixtures; the browser journeys use real Next routes, real Prisma SQLite writes, and a real loopback provider for successful enrichment/translation/Ask/pipeline work. This evidence does not claim a signed desktop release or full-suite acceptance; the root agent runs those final gates independently.

## Final full-suite search correction

The root's first complete browser batch found an intermittent wrong-phrase → corrected-phrase failure. Two separate problems were repaired:

- The search journey's zero-row assertion could pass while the previous document was unloading. The test now waits positively for the submitted wrong-phrase URL, visible empty-result text, and submitted query value before typing the corrected phrase. It then verifies the corrected URL/value and original matching result, preserving scope and explicit sort assertions.
- FilterControls reset the controlled query in a passive mount effect. An input arriving after commit but before passive effects could be replaced with the initial query. The component now compares its previous source/query scope and only resets on an actual navigation change, in a layout effect before the new scope is displayed. Identical-scope rerenders retain the draft.

`filter-draft-hydration.test.tsx` reproduces early input between form commit and passive effects. Restoring the old production effect makes this test fail (expected `nomic embedding`, received `nomic`); the corrected code passes both draft lifecycle tests. The second case verifies same-scope rerender preservation and real source/query navigation reset. Combined with the existing relevance contract: 9/9 passed.

`npx playwright test tests/e2e/search.spec.ts --repeat-each=3 --reporter=line`: 6/6 passed. Exact word/phrase flow and embedding-unavailable fallback each passed three repetitions. Logs: r9-search-final-e2e.log, r9-search-final-unit.log, r9-search-old-regression.log. TypeScript and focused ESLint passed. The old code was restored only inside a try/finally regression experiment and the fixed source was reinstated before the passing checks. No full-suite acceptance is inferred from this focused run; root owns that final gate.
