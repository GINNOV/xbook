Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R6: Repair YouTube metadata

Calibration completed new-import uploader-title and publication-date mapping, including unknown-value handling. Raw playlist-addition metadata is preserved. Separate persisted addition time, uploader IDs, historical backfill, and unavailable-item handling remain pending.

What to do:

1. Map uploaders from `videoOwnerChannelTitle` and `videoOwnerChannelId`, with explicit handling for missing values.
2. Store playlist-addition time separately. Use `contentDetails.videoPublishedAt` or authoritative video metadata for Posted.
3. Backfill from stored raw data when possible. Bound quota-aware metadata fetches when needed.
4. Represent deleted, private, or unavailable items honestly. Retain useful prior captured content with an availability label.
5. Prevent unavailable or title-only items from receiving unsupported confident digests.

Success criteria:

- A mixed-uploader playlist shows the correct creator for each fixture.
- Publication and playlist-addition dates retain separate meanings.
- Missing authors remain unknown instead of becoming the playlist owner.
- Deleted placeholders do not receive fabricated fresh summaries.
- Repair preserves IDs, memberships, read state, and manual edits.

A subagent may verify fixtures while one owner implements mapping and backfill.



## Tracking

- Y1: Uploader/addition/availability metadata migration; acceptance: Creator/publication/addition remain distinct; unknown/private/deleted states honest.
- Y2: Idempotent raw-data backfill and bounded refresh; acceptance: Two backfills stable; quota/cap checkpoint and read/edit/ID preservation verified.
- Y3: Unavailable/title-only digest policy and display; acceptance: Prior capture readable with limits; backend eligibility verified; explicit replacement choice shown without forced overwrite.