# R8 X diagnostics privacy and bounded execution

`GET /api/x/diagnostics` uses the current `getAuthContext(signal)` boundary, which retains the shared OAuth refresh/expiry behavior. The endpoint returns credential-presence booleans, a masked API destination, token expiry, probe HTTP status and safe action messages. It never returns account IDs, scopes, provider bodies, headers, bookmark content, raw exceptions, or credential values. URL credentials, queries and fragments are rejected before authorization or provider work.

One five-second deadline covers authorization and both probes, combined with the caller abort signal. Successful JSON responses are limited to 64 KiB while streaming and validated against the minimal expected shape. Denied bodies are discarded without parsing; failed account access skips bookmark access. Authorization failures direct the user to reconnect in Settings → Connections; quota, endpoint, timeout and cancellation outcomes remain distinct and safe.

Verification: `npx vitest run tests/unit/x-diagnostics-http.test.ts` passed all 10 tests. A disposable loopback HTTP server exercises successful and denied responses echoing a synthetic secret and private fixture text, declared/chunked oversized JSON, malformed JSON, real hanging headers/body deadlines, and in-flight cancellation. Authorization and settings boundaries are mocked with synthetic values; no live account or production database is used. Fixture connections explicitly close to avoid sharing sockets between modes. OAuth refresh implementation remains owned and tested by the shared helper owner.

`npx tsc --noEmit` passed. Targeted ESLint passed with no warnings or errors. Logs: `r8-x-diagnostics.log`, `r8-x-diagnostics-types.log`, `r8-x-diagnostics-lint.log`.
