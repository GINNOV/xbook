Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R9: Repair library interactions

What to do:

1. Add filters for existing unread, failed, blocked, stale-index, and unindexed states. Share predicates with dashboard counts.
2. Display read, edited, and processing states independently so an edit cannot hide a failure.
3. Improve the existing inspector for narrow windows without forcing the wide metadata table into the reading area.
4. Verify edit, read toggle, reprocess, translation, and close actions. Reject stale responses after selection changes.
5. Preserve filter and sort context. Provide accessible names, predictable keyboard focus, appropriate Escape dismissal, and retry feedback.

Success criteria:

- State-filter results agree with corresponding counts.
- Translation for item A never appears in item B after rapid selection changes.
- Failed actions preserve the last valid data and offer a retry.
- Keyboard users can open and close readers and dialogs with predictable focus.
- Existing reading actions work at 900-pixel desktop width. Verify responsive behavior at 390 pixels.

## Tracking

- L1: Shared state predicates for filters and counts; acceptance: Unread/failed/blocked/stale/unindexed query results match counts.
- L2: Library state filters and independent state display; acceptance: Read/edit/failure states remain independent and filter context preserved.
- L3: Reader action races, keyboard and responsive behavior; acceptance: A response cannot appear in B; retry/focus/Escape and 900/390px journeys pass.