# Live model acceptance, October 6, 2026

The user made Ollama available and supplied the Qwen server/model for the remaining T1 evaluation. The approved models are `nomic-embed-text` and `qwen3.8-27b-sglang`. The supplied HTTPS URL failed the TLS handshake in both curl and Node 24. The same approved LAN host/port advertises the correct model over HTTP. Only synthetic fixture content was sent over that connection. Certificate verification was not disabled. No saved settings or data in the live private database were read or changed during this acceptance run.

## Fixed live evaluation

The actual xbook Ask route, semantic/keyword retrieval, captured evidence, model clients, summary reduction and translation ran against a newly migrated disposable SQLite database. Model responses were not mocked. A separate explicit configuration keeps these tests out of the default offline suite; reproducible environment arguments are documented in `tests/live/README.md` without publishing the LAN address.

All five cases pass in `live.log` and `live-results.json`:

1. Real 768-dimensional embeddings and a retained fact beyond the first 500 characters produce the answer `lavender-seven`, with a supplied exact excerpt and the retained passage's timestamp, 2970 seconds. This is the start of the stored passage containing the final event, not a claim of word-level timestamp precision.
2. A private birthday absent from the saved sources produces insufficient evidence and no citations despite available candidates and a real model request.
3. A description-only source explicitly discloses missing full-video access; a requested uncaptured measurement is declined.
4. A long source passes through three section reductions and a final digest, retaining the tail code and explicit incomplete-source limitations. Four real summary requests are recorded.
5. On-demand translation uses saved Target language `Italian`, returns plain Italian text, and preserves `03:15`.

This is the fixed acceptance set, not a guarantee that every future generated answer or translation is correct.

## Corrections discovered by live acceptance

The first run passed three cases and failed two; both failures remain in `before-fix.log`. The tail answer was correct, but the fixture expected the final event's 3000-second time instead of its retained section's start time. The assertion now resolves the section that contains the exact fact and checks its actual timestamp.

Translation initially returned empty content after using its response allowance. A direct synthetic probe with SGLang's hard thinking switch completed, but returned JSON because xbook's default system instruction required JSON for translation too. The correction replaces that default instruction with a plain-text translation instruction while preserving custom system prompts. Qwen models advertised by SGLang or vLLM also receive the configured thinking preference through `chat_template_kwargs.enable_thinking`; other providers retain the generic request, and an unavailable model registry does not block otherwise usable chat. Cancellation is preserved. [Qwen's SGLang documentation](https://qwen.readthedocs.io/en/latest/deployment/sglang.html#thinking-non-thinking-modes) documents this native switch.

Five loopback HTTP regression cases cover disabled/enabled thinking, provider compatibility, missing registry access, the default translation format, and custom instructions. The combined focused run passes 15 tests. The complete offline suite passes 579 tests in 69 files, and all 22 Chromium workflows pass. TypeScript and ESLint pass. Production/standalone desktop and unsigned native builds pass for application source `95cde61`.

An initial native unit run failed its ownership fixture. That fixture answered and closed after one socket read, which can leave part of the HTTP request unread. It now drains the complete request headers before replying, and checks the requested version route. The final two native tests pass; the earlier failure is retained in `native-tests-before-fix.log`. This changes only the test fixture, not the packaged native runtime.

## Packaged application acceptance

A fresh fixture was created with all 31 migrations. The unsigned verification app ran on port 3116 with its separate bundle identifier and verified process-specific ownership. Its backend identified application commit `95cde61`. Seven pages, backup/restore, subsequent writes, duplicate-name rejection, path traversal rejection, capture/enrichment/indexing, stale-error clearing and idempotency pass in `native-http.log` and `native-http.json`.

After configuring only that disposable fixture for the approved providers, packaged HTTP Ask returns `violet-eight` with a supplied excerpt, declines an unsupported birthday, and returns a successful plain Italian translation. Those actual outputs are in `native-live-model-results.json`.

Native computer-use acceptance also submitted the supported question through Ask AI and observed the answer plus its supporting excerpt. Opening Synthetic note and pressing Translate displayed Translation completed and the plain Italian source text with `03:15`. The reader was visually inspected. The verification app was quit through its own shortcut; both its app PID 76605 and backend PID 76634 exited, and no post-quit app inspection was requested.

## Default-branch and issue acceptance

This live evaluation satisfies the previously missing T1 check. The code correction and evidence reached main in [PR #64](https://github.com/GINNOV/xbook/pull/64), merge commit `8879348573befa3c540660f6ce55133a9fd9540f`. Issues #14, #43 and #18 closed after merge; all 55 corresponding bug issues are confirmed closed. [Observed issue states](issue-states.json) and [resolution notes](resolution-notes.json) record that confirmation. The October 2 coverage, native incident and its unavailable pre-launch snapshot remain historical evidence; this successful isolated run does not undo or conceal that incident. No desktop release, signing keys, version bump, updater installation or release tag was used.
