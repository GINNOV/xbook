Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R11 and C1: Accept the repaired application

What to do:

1. Run `npm run lint`, `npm run test`, `npm run test:e2e`, and `npm run build`. Resolve regressions and distinguish unrelated baseline failures.
2. Exercise import, enrich, index, filter, read, edit, translate, folder processing, settings, and documentation navigation using isolated data.
3. Verify interruption, resume, provider errors, cancellation, event reconnection, and duplicate requests.
4. Migrate a copy of a pre-change database. Check bookmarks, memberships, settings, read state, manual edits, logs, and agent IDs.
5. Back up and restore migrated fixtures. Verify desktop startup and workers using repository build procedures.
6. Measure a fixed search-query set and documented library sizes. Separate embedding-provider latency from local ranking time. Report known-item recall among the first five results and remaining failures.
7. Use C1 only for acceptance defects and contingency. Do not fill unused time with unapproved features.

Success criteria:

- Each confirmed finding has passing evidence or an explicitly approved deferral.
- All seven panes pass their workflow checks. Subagent assertions do not substitute for verification.
- Migration and restoration preserve user-owned data.
- Fixtures expose no duplicate workers, permanently stranded operations, or false total-failure successes.
- Search scope and freshness checks pass deterministically. Measurements disclose remaining quality and latency limitations.
- Handoff includes changed files, workflow screenshots, check results, migration notes, and outstanding issues.

## Tracking

- T1: Fixed live-model question and translation evaluation; acceptance: Approved endpoint supports tail/unsupported/partial questions and documented translation.
- T2: Full checks and seven-pane end-to-end journeys; acceptance: Seven-pane checks include duplicate/stop/provider-error/reconnect cases; ordinary acceptance defects fixed; unapproved required failures remain open.
- T3: Old database migration/backup/restore acceptance; acceptance: Bookmark content/settings/logs/agent IDs/memberships/read/manual edits preserved under migrated restore.
- T4: Desktop startup and interruption acceptance; acceptance: npm run build:desktop then npx tauri build, with isolated startup start disposable bundle/DB/port; hot reload, port reuse, stop/restart and ownership checked; cold toolchain extra.
- T5: Fixed-query recall and latency benchmark; acceptance: Documented fixture sizes, known-item top5 recall and provider/local latency recorded.
- T6: Reviewable screenshots, migration notes and final handoff; acceptance: Changed files/evidence/outstanding checks delivered for review.