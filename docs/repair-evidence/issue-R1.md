Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R1: Protect data before migrations

What to do:

1. Replace raw active-file backup copies with a consistent SQLite snapshot supported by the adapter. Verify concurrent writes and WAL behavior using the [SQLite backup guidance](https://www.sqlite.org/backup.html).
2. Stage restore files. Check integrity, required tables, and schema compatibility before replacing the active database.
3. Block conflicting writes, create a recovery snapshot, replace safely, reconnect, and roll back on failure.
4. Prevent silent overwrite when a custom backup name already exists. Explain that desktop backups are local and may contain stored credentials and technical logs.
5. Preserve current confirmation dialogs. Keep clear and delete operations outside live automated verification.

Success criteria:

- A backup made during synthetic writes restores consistently and passes an integrity check.
- Corrupt or incompatible files leave the active database unchanged.
- Injected replacement or reconnect failures are recoverable.
- Restore cannot race active processing.
- Reusing a backup name preserves the earlier file or requires an explicit overwrite choice.

One owner implements database operations. A subagent may verify failures against separate disposable files.



## Tracking

- D1: Stage and validate restore candidate; acceptance: Integrity, required tables and migration version validated; corrupt/incompatible/traversal candidates leave active fixture untouched.
- D4: Durable maintenance ownership and restore recovery journal; acceptance: Cross-process maintenance ownership and startup journal recover a process killed during staged replacement.
- D2: Quiesce writes, swap database, reconnect; acceptance: Concurrent writes excluded across backend processes; restored fixture accepts Prisma writes.
- D3: Failure rollback and restore feedback; acceptance: Injected swap/reconnect/crash failures recover original records and relationships.

Reuse #1 and #3 for export credential protection and custom download naming. Existing PRs #4/#5 overlap; integrate and verify their changes rather than duplicate them.