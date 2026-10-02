# R8 S3 OAuth backend acceptance

All verification used migrated disposable SQLite databases and fixture responses, including a local HTTP token/account server. No live provider account or application database was accessed.

Implemented in the X/YouTube OAuth helpers and routes:

- Pending state is provider-prefixed (`x:`/`yt:`), expires after ten minutes, and is claimed atomically once. Concurrent replay cannot delete the original callback's claim. Legacy unbound sessions require starting sign-in again.
- Session payloads bind the PKCE verifier, client ID, redirect URI, API base, and configuration fingerprint. Client secrets and tokens are not stored in pending sessions. Configuration changes require restarting sign-in.
- Token exchanges and refresh responses have a fifteen-second request/body deadline, a 64 KiB limit, cancellation checks, no followed redirects, and validated nonempty bearer tokens plus positive bounded expiry. Provider error bodies are never returned to clients.
- Failed or malformed exchange/refresh preserves existing credentials and supplies a retry/reconnect action. Missing credentials are rejected before any `Bearer null` account request; expired credentials lacking refresh configuration are rejected before a provider call.
- Refresh CAS matches saved token, expiry, client configuration, and account snapshot. Optional omitted refresh tokens retain the previous refresh token; returned rotation is persisted. Callback commits match their original credential snapshot and require their still-valid claimed session under SQLite's writer lock.
- Settings disconnect atomically clears provider sessions, including claimed callbacks. Both already-connected and initially-null pending connections were tested to ensure an in-flight callback cannot reconnect them after disconnect.
- The URL generator rejects unsaved configuration instead of generating an authorization URL whose callback would use different settings. Existing start/callback aliases and success redirect contracts remain intact.

Commands (Node 24):

```sh
npx vitest run tests/unit/oauth-backend-real-db.test.ts
npx vitest run tests/unit/x.test.ts tests/unit/youtube.test.ts tests/unit/oauth-redirect.test.ts tests/unit/youtube-oauth-connect.test.ts tests/unit/oauth-backend-real-db.test.ts
npx eslint src/lib/oauth-tokens.ts src/lib/oauth-flow.ts src/lib/x.ts src/lib/youtube.ts src/app/api/x/oauth/start/route.ts src/app/api/x/oauth/callback/route.ts src/app/api/youtube/oauth/start/route.ts src/app/api/youtube/oauth/callback/route.ts src/app/api/youtube/oauth/url/route.ts tests/unit/oauth-backend-real-db.test.ts tests/unit/x.test.ts
npx tsc --noEmit
```

Final focused backend result: **46 new tests passed**. Combined existing OAuth/provider/redirect/hook verification: **5 files, 67 tests passed**. Related durable import, X folder sync, metadata repair and connection API checks: **5 files, 53 tests passed**. Focused lint passed without warnings; full TypeScript check passed.

The current YouTube import identity uses client/verified playlist ownership rather than refresh-token bytes, so ordinary refresh rotation does not impersonate an account switch. This work does not assert live Google/X sign-in acceptance or overall R8 UI acceptance.

Protocol references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth 2.0 RFC 6749](https://www.rfc-editor.org/rfc/rfc6749).
