Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R5: Repair folders and imports

What to do:

1. Link folder names and counts to the correctly scoped library.
2. Apply R4's lifecycle to X imports, Import all, YouTube playlist actions, and dashboard imports.
3. Preserve checkpoints and cap rules. Distinguish new, refreshed, skipped, and unavailable entries.
4. Verify assignment updates for existing items and preserve manual enrichment during refresh.
5. Explain whether each action syncs names, imports, summarizes, or indexes. Use consistent labels across sources.
6. Show local counts and activity dates. Retain source changes already implemented. Avoid window reloads that discard context.
7. Distinguish playlist entries from unique videos where duplicates exist. Preserve existing IDs and memberships. Defer canonical merging unless a confirmed defect requires it.

Success criteria:

- A folder opens exactly its local items, including a useful empty state.
- Repeated import creates no duplicate records and preserves human edits.
- A cap stop reports its reason and supports later continuation.
- Import all survives navigation and preserves progress when a folder fails.
- Conflicting operations do not corrupt progress.
- Count labels explain entries versus unique videos where those differ.

## Tracking

- F1: Folder links and action labels; acceptance: Local folder scope including empty state opens correctly; actions named accurately.
- F2: X/YouTube/global/folder import checkpoint adapters; acceptance: Refresh preserves IDs, assignments and manual enrichment; caps checkpoint correctly.
- F3: Server-owned Import all; acceptance: Navigation/restart preserve per-folder progress and prevent duplicate commits.
- F4: Refresh/count labels and context preservation; acceptance: Entry/unique-video counts labeled; repeated import and refresh preserve context.