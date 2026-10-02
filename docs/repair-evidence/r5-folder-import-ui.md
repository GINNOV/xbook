# R5 folder and durable import UI verification

Verified 2026-10-02 in the complete-repairs worktree, after integrating origin/main. No commits, pushes, production data, or external provider requests were made by this verification.

The dashboard Import and Process Inbox actions submit one durable operation. Process Inbox uses `pipeline=true` so import, summarization, and indexing continue on the server under the same run ID. Folder and playlist actions likewise submit one scoped import, summarize, or index operation. Names, counts, and empty-state recovery links retain the source and exact folder ID. The UI displays local playlist entry counts separately from unique video identities and live provider entry counts.

Import progress comes from the persisted import checkpoint: imported, refreshed, skipped, unavailable, pages, folder outcomes, and pipeline phase. It avoids displaying task checkpoint totals as an imported-bookmark denominator. Paused cap work links to Settings Limits and resumes the original run ID. Operation response validation accepts the real server's nullable error field. Acknowledged IDs are retained if navigation detaches the observer.

## Checks

- `npx vitest run tests/unit/operation-observer.test.tsx tests/unit/hooks/useActions.test.tsx tests/unit/hooks/useFoldersPanel.test.tsx`: 16 passed. Covers single submission, idempotency, authoritative cumulative snapshots, reconnect, stop/resume, imports, server-owned Process Inbox, scoped playlist summarize/index, and names refresh without reload.
- `npx playwright test tests/e2e/folder-import.spec.ts`: 3 passed with a disposable migrated SQLite database and loopback X provider.
- The browser scope journey opens X folder names/counts and an empty folder with a useful import link. Two saved playlist entries referencing one video remain distinct; the playlist link opens only its own local entry.
- The import-all journey leaves Folder Management after acknowledgment. Server processing finishes two folders despite a third provider 404. Returning displays the same operation and failure cause. Existing manual summary, read date, edit date, capture JSON, and folder ID are preserved. Only one import submission is made.
- The cap journey pauses after one new entry with one buffered entry. Raising the cap and clicking Resume completes the original run, imports exactly two rows, and does not fetch the same folder page again.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with one existing unused-variable warning in `src/lib/llm.ts`.
- A combined earlier browser batch also passed both `metadata-repair.spec.ts` cases, owned by the R6 worker.

Logs: `r5-ui-unit.log`, `r5-ui-e2e.log`, `r5-ui-types.log`, `r5-ui-lint.log`. Visually inspected screenshots: `r5-folder-scope.png`, `r5-import-all-partial.png`, `r5-cap-recovery.png`.

The R5 browser checks do not claim import-worker process-restart acceptance or retry of a repaired failed folder. Those backend lifecycle checks are owned by the lifecycle worker. Existing rawJson-only legacy playlist membership is not counted as an openable folder until assigned to the actual folderId; metadata backfill does not change that assignment.
