# Export and custom download acceptance

2026-10-02, isolated codex/complete-repairs worktree, Node 24.21.0, port 3101, fresh synthetic dev.db.

- 39 focused Vitest cases pass across six existing PR4/5 test files. Real SQLite tests verify credential exclusion by default, explicit inclusion, pending OAuth exclusion, deleted-secret byte removal, WAL capture, source preservation, naming and query combinations.
- Running Settings Data tab opens Database management. Checkbox unchecked by default. Draft custom name `repair_acceptance` yields `/api/settings/database/backup?customName=repair_acceptance&includeSecrets=false`. Browser HTTP request returns 200, Content-Disposition `repair_acceptance.db`, Cache-Control no-store and 131072-byte SQLite.
- Checking credentials option updates includeSecrets=true. Browser HTTP request again returns 200, correct name and no-store. Warning states account access risk. Screenshot data-export-opt-in.png captured and inspected.
- No live database, account connection, desktop updater or release changed.
- This accepts only export/naming behavior for issues #1/#3, not the full R1 restore requirement. Main integration and final issue closure remain pending.
