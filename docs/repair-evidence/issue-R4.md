Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R4: Repair processing and recovery

Calibration completed the embedding-sync total-failure outcome repair. Generic total failures now record Failed and return HTTP 502 with `ok: false`. Partial success and no-work behavior remain compatible. Persistent continuation, cancellation, recovery, and historical display repairs remain pending.

What to do:

1. Define honest outcomes for complete success, partial failure, total failure, cancellation, and work remaining. Separate preflight failures from item failures.
2. Persist server-owned continuation for enrichment and indexing. Integrate imports in R5.
3. Persist scope, settings snapshots, checkpoints, retry counts, and cancellation. Make submission idempotent.
4. Prevent duplicate work through database claims or leases. Recover interrupted operations at startup.
5. Retry transient failures within a budget. Stop configuration errors early and link to the relevant settings.
6. Make stop controls, event reconnection, and counters consistent across Dashboard, Folders, Processing, and single-item actions.
7. Correct historical outcome displays from trustworthy recorded counters without rewriting logs as successful.

Success criteria:

- An operation with zero successes and all attempts failed never shows Completed.
- Partial successes show both output and failures. Paused work is not called finished.
- Navigation does not end continuation. Restart permits safe recovery.
- Duplicate submissions and competing workers do not duplicate completed writes.
- Stop prevents new work and aborts active calls where supported.
- Preflight failures show the cause and repair action even with zero attempted items.
- Development and desktop startup do not accidentally create competing workers.

One owner controls lifecycle. Subagents may build controls and fault-injection cases after the contract is defined.



## Tracking

- P1: Outcome and backward-compatibility contract; acceptance: Success/partial/failure/stop/preflight/work-remaining agree in API and history.
- P2: Durable enrichment submission and checkpoints; acceptance: Crash/duplicate requests preserve checkpoint and intervening human edits.
- P3: Server-owned continuation and startup recovery; acceptance: Enrichment and embedding continue autonomously after navigation/restart; competing desktop/dev workers fenced.
- P4: Retry budget, abort propagation and preflight errors; acceptance: Retries bounded; configuration failures stop early; supported calls abort on stop.
- P5: Controls, reconnect, counters and historical display; acceptance: Dashboard/folder/processing controls agree; ambiguous old outcomes not fabricated.