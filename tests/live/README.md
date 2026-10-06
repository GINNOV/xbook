# Live model acceptance

These tests are excluded from `npm test`. They require explicit authorization of both endpoints and model names. Run them with Node 24 and synthetic data only:

```sh
XBOOK_LIVE_ACCEPTANCE=1 \
XBOOK_LIVE_CHAT_URL='<approved OpenAI-compatible chat URL>' \
XBOOK_LIVE_CHAT_MODEL='<approved chat model>' \
XBOOK_LIVE_EMBEDDING_URL='<approved OpenAI-compatible embedding URL>' \
XBOOK_LIVE_EMBEDDING_MODEL='nomic-embed-text' \
XBOOK_LIVE_REPORT='/tmp/xbook-live-model-results.json' \
npx vitest run --config vitest.live.config.ts
```

The separate configuration uses the actual xbook Ask route, retrieval, source capture, summary reduction, translation, and model clients. Only database access is replaced with a newly migrated temporary SQLite database. It stores synthetic Settings, bookmarks, and logs, then disconnects and deletes the fixture. It never imports or opens the live application's database. No private account credentials are read or supplied; the provider receives a synthetic placeholder API key.

The fixed cases verify 768-dimensional embeddings, a tail fact in a long timestamped source, supplied citation excerpts, unsupported questions, description-only partial-source disclosure, unavailable video details, long-source summary reduction, and Italian on-demand translation. Outputs and request counts are written to the optional report file. The test uses no provider-response mocks. Five passing cases establish this fixed evaluation; they do not guarantee that every future model response is correct.

Use the protocol actually supported by the approved server. Do not disable certificate validation to make an HTTPS URL work. No saved application settings or desktop release are changed by this command.
