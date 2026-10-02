# Final integration acceptance

This record covers the complete repair branch, including the externally merged restore PR #61 and the public-origin OAuth fix from `3ec1ecf`. The primary checkout and its untracked planning/calibration material remain preserved. No desktop release, version bump, signing-key access, tag, updater installation, or published installer was performed.

## Verification

The final gate logs are in this directory. Final source commit `4aead0f` passes 574 unit/integration tests in 68 files, all 22 Chromium workflows, TypeScript and ESLint with zero errors, the Next production/standalone desktop build, and the unsigned native build. The two Rust ownership/port tests pass. The subsequent merge of `f028b1c` changes worktree documentation and its setup-message example only; application code is identical to the verified source. Focused reports elsewhere in `repair-evidence` retain their original timestamps and scope; their passing counts do not replace the final integration gates.

- Real migrated SQLite tests cover scope before semantic ranking, exact text modes, vector identity/freshness/validation, atomic job claims/checkpoints, cancellation, bounded retries, SIGKILL recovery, import buffers/caps/partial-folder recovery, metadata repair, source capture, concurrent human edits, and OAuth sessions/refresh/disconnect.
- Browser journeys cover all seven panes, 390/900 px reader/editor focus, original-ID import continuation, partial failure, cap resume, independent Settings drafts and tests, saved timed source evidence, Ask citations, translation repair, model failure/resume, exact/fallback search, Dashboard health links, and Docs navigation.
- Historical migration acceptance compares every old column in nine tables in a disposable 27-migration fixture before/after the current 31-migration deployment, online backup, restore, integrity/foreign-key checks, and subsequent writes. Manual summaries, read state, agent IDs, credentials/settings, logs, and memberships are preserved in those fixtures.
- The fixed 100/1,000/10,000-item benchmark returned all 33 known items in the first five results, plus all three offline fallback cases. Its deterministic 768-dimensional vectors and loopback provider timings establish retrieval behavior, not live semantic quality or inference performance.

## Desktop workflow

The repository's `npm run build:desktop` and `npx tauri build` workflow was used with Node 24 and a task-specific Rust installation. The native verification override uses `--no-sign`, a separate `com.blife.xbook.repairverification` identifier, and `bundle.createUpdaterArtifacts=false`. This produces a local test app without requiring release keys or publishing an update.

Controlled runtime acceptance uses a disposable SQLite database on port 3116. Packaged X/YouTube authorization URL and denied-callback checks also retain the localhost public origin without following an external authorization redirect. The app shows app/desktop version, backend port, PID, and build commit, and verifies its own process-specific ownership before navigation. Seven packaged pages return 200. Real HTTP checks pass for consistent backup, duplicate-name 409, edit/restore, preserved human/read/folder data, guarded subsequent writes, traversal 400, download filenames/header, single-item capture/enrichment/indexing, stale-failure clearing, and idempotent replay. The loopback model receives one chat request and one embedding request. Native Escape restores the reader's opener; Settings labels configured models as untested; updater failure remains visible without blocking startup.

The native app was quit through its own menu shortcut. Its owned backend exited; the pre-existing installed app/server stayed running. Restart produced a new owner/PID and retained the fixture's human/generated summaries. A wildcard HTTP listener on port 3118 produced a useful native warning before the sentinel database was created. An additional default-port warning rejected the already-running installed server.

A separate actual Next development run on port 3117 held the second provider request, changed the worker module to trigger hot reload, replayed submission, and completed the original operation. The first committed item survived, the same run ID was reused, and each item made exactly one provider request. The original source bytes were restored and all verification instances stopped.

## Acceptance corrections and deviations

- Existing upstream fixes were retained, including default-branch public OAuth origins. The new session flow uses those origins for authorization URI fingerprints and callback destinations; successful X/YouTube callback and URL-generation regressions cover wildcard bind addresses.
- Capture uses Readability/JSDOM, pinned public destinations, bounded redirects/body/deadlines, and explicit retained-source limitations. Long capture stores bounded distributed passages including tail evidence; section reduction carries capture warnings to the final prompt.
- Missing embedding models remain missing. Summarization can proceed with chat while semantic operations require an explicit embedding model. Pipeline summarization defers embedding generation to its separate indexing stage, avoiding duplicate requests.
- YouTube imports pin the public client fingerprint and verified playlist content owner rather than rotating token bytes. The frozen playlist ID bounds single-folder work; this does not claim that playlist ownership identifies the authenticated Google account.
- Legacy startup recovery appends interruption diagnostics and compares the prior status/config/notes before updates. It does not erase original diagnostics or change a concurrently completed run.
- Integration failures were investigated rather than ignored: stale accessible-name selectors, an invalid empty-result transition assertion, unrealistic sub-100 ms lease fixtures under parallel load, replaced by explicit expiry after a committed checkpoint, and provider fixtures that ignored the SDK's base64 request were corrected. Meaningful lease renewal, crash fencing, scoped retrieval, saved-vector and single-request assertions remain.

## Native verification incident

An early verification launcher exited. Selecting the app through computer use subsequently launched it with the default environment rather than the intended disposable database/port. This instance was closed immediately after discovery. Read-only inspection confirmed four additive schema migrations, two unfinished legacy ImportRun records marked interrupted, and an advanced Settings update timestamp. There were no bookmark edit/summary timestamps in that interval; SQLite integrity and foreign-key checks passed. There is no authoritative pre-launch snapshot proving all original Settings fields or the two overwritten import notes, so this record does not claim the default database was unchanged. No speculative rollback of live data or credentials was attempted. The incident was disclosed to the user.

Verification now keeps its launcher alive, selects the app by its distinct bundle identifier, and verifies the dedicated port/ownership before interaction. The strengthened native check probes an existing listener before binding, including wildcard listeners on macOS. These protections passed the controlled warning/no-database test and default-port rejection. Computer-use inspection after quitting can automatically relaunch an app; shutdown is therefore confirmed through the owned process identities, without requesting another app inspection.

## Outstanding live acceptance

T1 remains unavailable. Both local model-list endpoints, `127.0.0.1:1234/v1/models` and `127.0.0.1:11434/v1/models`, refused connections. No alternative endpoint/model pair was explicitly approved for live acceptance. Controlled tail-fact, unsupported-question, partial/description-only evidence, citation/timestamp, and translation tests pass; they do not establish a live model's answer quality.

Issues #14, #43, and #18 must remain open until an approved chat/embedding endpoint is available and the fixed live evaluation passes. A pre-launch database snapshot would also be needed to reconstruct the two import notes or compare every original Settings field affected by the incident. All independent code and controlled verification reached main in PR #62 at `5fe4320`. GitHub confirms 52 corresponding bug issues closed; #14/#43/#18 remain open with blocker notes. The full 55-issue coverage table and resolution-note links are in `docs/repair-coverage.md`.

## Concurrent worktree guidance

Default branch commit `f028b1c` changed the worktree rule during verification to `/Volumes/AIWork/code/worktrees/Xbook/<name>`. That volume is not mounted here. The new guidance is preserved; no new worktree was created, and the already-running isolated checkout was retained rather than moving or modifying unrelated checkouts. Future worktrees require that volume.
