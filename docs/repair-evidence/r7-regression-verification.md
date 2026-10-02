# R7 independent source regression verification

Verified in the isolated `complete-repairs/xbook` worktree with synthetic SQLite rows and fixture providers; no live database or account requests.

Command (Node 24):

```sh
npx vitest run tests/unit/source-recapture.test.ts tests/unit/embedding-index-real-db.test.ts tests/unit/llm-snapshot.test.ts tests/unit/v4-evidence-job-acceptance.test.ts
```

Result: **4 files, 32 tests passed** on 2026-10-02. Eleven newly added regressions exercise:

- Actual durable enrichment worker commits reject text, provider JSON, or captured evidence changes made while the LLM response is in flight. Existing summary, read state, and provenance survive.
- A failed transcript recapture retains previous timestamped evidence. Unavailable video status retains previous capture without requesting the unavailable source.
- Failed linked article recapture retains previous article evidence and explicitly marks the limitation. This regression initially failed because the fallback replaced useful article evidence with the short post; the root implementation now passes.
- Missing or partial title-only YouTube evidence declines Ask without a provider request. An excessive system prompt likewise declines before a paid request.
- The timestamp on a returned quote belongs to its quoted later passage rather than the first selected passage.
- Long-source section reduction supplies final summarization with the partial capture status, description method, source limitation, and retained tail fact.

This is focused backend regression acceptance, not a claim that all R7 UI or calibration requirements are complete.
