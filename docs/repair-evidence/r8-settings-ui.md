# R8 Settings UI verification

Verified October 2, 2026 using synthetic data in a disposable migrated SQLite database and a loopback HTTP chat/embedding provider. No real OAuth account or external AI provider was contacted.

Settings now stores connection test results in the form context, separately for chat, embeddings, X, and YouTube. Each result belongs to the exact submitted draft fields and is invalidated when those fields change. A configured model or stored token is not labelled tested. Expired tokens show expired; a working chat model with failed embeddings remains visibly unavailable for embeddings. Tests omit unrelated settings and transmit explicit empty/null displayed values rather than silently substituting saved configuration.

Dirty state derives from the saved draft and catches presets, model-history selections, prompts, numeric fields, and checkboxes. Tab changes preserve drafts and results. Incoming server props refresh the baseline while preserving unsaved edits. Saving rejects invalid numeric limits before sending work, reports visible success/failure, and retains edits after a failure. App-link navigation offers an explicit discard choice, and browser unload warns about unsaved changes. Saved OAuth changes patch only connection fields and preserve unrelated drafts.

AI help identifies local/LAN/remote destinations without URL credentials or query secrets, explains text sent to chat and embedding endpoints, and describes local payload logs. Batch size means items per operation batch; response tokens and concurrency are separate. Response limit zero removes that extra cap while other enrichment token/context budgets apply. Secret inputs have associated labels and remain masked by default. X test/connect/diagnostics buttons do not accidentally submit the outer form. Model-list and maintenance feedback remains separate from chat test status. Settings embedding sync now uses the durable full-scope observer.

Desktop YouTube sign-in observation accepts an AbortSignal, stops on unmount, and exposes Stop waiting for sign-in. This stops observation, not account authorization. Poll cancellation does not clear credentials or library items. Server OAuth expiry/refresh/callback/disconnect tests are owned by the root worker and are not inferred from these UI checks.

## Checks

- Six focused unit files: 30 passed. Includes independent exact-draft tests, invalidation, tab retention, dirty presets/refresh, invalid numeric boundaries, failed/successful save, stale-request completion, saved OAuth patch preservation, navigation discard choice, secret-free destination labels, and cancellable sign-in polling.
- `tests/e2e/settings-draft.spec.ts`: two provider-backed Chromium journeys passed. Real HTTP evidence verifies displayed draft model/URL, empty embedding endpoint fallback to displayed chat endpoint, separate embedding failure/success, no API-key text disclosure, no saving during tests, invalid batch input causing zero save requests, failed save retaining edits, and successful retry persisted to SQLite.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; warnings at the time of this run belong to root-owned Settings API/OAuth fixture files.
- Screenshots inspected: `r8-chat-embedding-state.png`, `r8-save-feedback.png`.

Logs: `r8-ui-unit.log`, `r8-ui-types.log`, `r8-ui-lint.log`, `r8-ui-e2e.log`. The final browser rerun passed against the final UI and additionally verifies that cancelling the discard dialog retains the displayed draft during app-link navigation. Port 3100 and the shared development lock were released after verification.
