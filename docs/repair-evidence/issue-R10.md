Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R10: Repair Dashboard, desktop feedback, and Docs

What to do:

1. State semantic coverage's denominator. Separate library coverage, pending enrichment, missing vectors, and stale or incompatible vectors.
2. Link dashboard counts to matching scoped views.
3. Use source-specific last-sync information. Separate local import limits from provider quotas and LLM usage.
4. Show app version and useful backend identity. Expose update-check failure and retry feedback. Do not install an update during verification.
5. Use a neutral indicator for normal processing and reserve alerts for failures.
6. Update Docs, README, developer instructions, and API examples. Correct source-toggle instructions, privacy language, folder actions, outcomes, and backup terminology.

Success criteria:

- No percentage implies full-library semantic coverage while stored items are excluded.
- Metric links open matching scope and reconcile with documented counts.
- X and YouTube last-sync information cannot be confused.
- A simulated unavailable updater shows useful status without blocking startup.
- All seven panes have accurate instructions. Agent examples match the delivered API.

Dashboard and Docs may use separate subagents after metric definitions are settled. The primary AI verifies desktop behavior.



## Tracking

- H1: Dashboard denominators, links and source-sync metrics; acceptance: Coverage/links/source sync/counts agree; quotas, local caps and LLM usage distinct; normal processing neutral.
- H2: Version/backend/updater failure feedback; acceptance: Unavailable updater has retry status and does not block startup; no update installed.
- H3: Seven-pane Docs/README/API examples; acceptance: Seven-pane Docs/README/AGENTS/API examples agree with behavior and remote-content/privacy/log semantics.