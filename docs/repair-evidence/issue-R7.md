Repair requirement from docs/implementation-plan.md, authorized October 2, 2026.

## Requirements and acceptance

R7: Repair enrichment and Ask

What to do:

1. Share extraction between single and bulk processing. Clear obsolete failure state after a successful retry.
2. Extract article bodies with bounded size, redirects, and timeouts. Validate protocols and public-web destinations.
3. Store capture method, completeness, language, timestamps, and failure reasons separately from generated summaries.
4. Process long material in bounded sections instead of silent truncation. Retain transcript timestamps when available.
5. Give Ask useful evidence within its context budget. Include exact keyword candidates when semantic retrieval misses them.
6. Validate citation IDs against supplied evidence. Show supporting excerpts and video timestamps. Decline unsupported answers.
7. Preserve human corrections during ordinary reprocessing. Offer an explicit replace option and record generation provenance.
8. Preserve the target-language setting's documented translation meaning. Make summary-language behavior explicit without silently expanding that setting's scope.

Success criteria:

- Single and bulk routes produce equivalent capture states for the same source.
- A fact near the end of a long fixture can support a summary or answer.
- Description-only and partial-source digests disclose their limitations.
- Citations resolve to evidence supplied to the model. Unsupported questions produce insufficient-evidence responses.
- Reprocessing preserves human corrections by default and clears stale errors on success.
- Missing captions produce a fallback instead of failing the whole operation.

## Tracking

- E1: Versioned capture/provenance/recapture contract; acceptance: Article/transcript/fallback capture preserves V6 evidence; unavailable/title-only source eligibility enforced in backend.
- E0: Human correction preservation, explicit replacement and generation provenance; acceptance: Ordinary reprocess preserves prior human corrections; explicit replacement recorded; concurrent edits still win.
- E2: Bounded article fetch and extraction; acceptance: Redirect/public-destination/size/stalled-body/extraction fixtures pass.
- E3: Transcript body bounds, cancellation and retry cleanup; acceptance: Timeout covers body; stop cancels capture; successful retry clears obsolete errors.
- E4: Section summaries and small-context budgets; acceptance: Tail facts survive bounded section/final summary with honest partial status.
- E5: Keyword candidate merge and evidence retrieval coverage; acceptance: Scoped exact evidence missed by summary vectors can enter Ask without budget overflow.
- E6: Citation support and insufficient-evidence behavior; acceptance: Unknown IDs rejected; citations resolve supplied evidence; unsupported fixtures decline.
- T1: Fixed live-model question and translation evaluation; acceptance: Approved endpoint supports tail/unsupported/partial questions and documented translation.