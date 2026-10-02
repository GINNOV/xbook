Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R8: Repair Settings

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

## Tracking

- S1: Draft chat/embedding tests and readiness states; acceptance: Displayed draft values tested independently; model name alone does not imply ready.
- S2: Settings forms, numeric/preset/save/privacy feedback; acceptance: Invalid numbers blocked; draft/preset/tab/save states correct; local/LAN/remote/log-storage help accurate and diagnostics masked.
- S3: OAuth isolated expiry/refresh/callback/cancel acceptance; acceptance: Both connectors isolated expiry/refresh/callback/cancel/disconnect cases preserve data and give recovery.