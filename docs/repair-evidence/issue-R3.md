Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R3: Repair indexing

What to do:

1. Store model identity, dimensions, indexed-content hash, and generation time through additive migrations.
2. Mark vectors stale after searchable content changes through the interface, enrichment, or agent API.
3. Retain the calibrated byte-view decoding repair. Add validation of dimensions, finite values, and nonzero magnitude.
4. Treat unknown legacy vectors as requiring verification or rebuild. Do not invent model identities.
5. Provide a controlled model-change rebuild with progress and keyword fallback.
6. Reject obsolete indexing results when the bookmark changed during generation.

Success criteria:

- Edits and appends cannot leave outdated vectors treated as current.
- Reindexing changes retrieval to reflect updated content.
- Incompatible or malformed vectors produce useful feedback without crashes or invalid comparisons.
- A concurrent edit prevents an obsolete vector from being accepted.
- Rebuild preserves bookmarks, folder relationships, and agent IDs.

One owner controls migrations and indexing. A subagent may verify malformed vectors and concurrent edits.



## Tracking

- M1: Model/endpoint/dimension metadata migration and writes; acceptance: All indexed writes share identity; old rows preserved with unknown identities.
- M2: Stored/query vector compatibility and validation; acceptance: Bad dimensions/bytes/nonfinite/zero/incompatible vectors do not rank.
- M3: Controlled compatible rebuild; acceptance: Restartable rebuild includes incompatible non-null vectors and preserves edits and IDs.