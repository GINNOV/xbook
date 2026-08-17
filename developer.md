# XBook Console Developer Guide

This document is for developers who want to set up, build, or contribute to XBook Console. For general information about what the app does, how to use it, and the native desktop experience, see [README.md](README.md).

---

## Technical Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma 7
- SQLite through `better-sqlite3`
- Tailwind CSS 4
- OpenAI-compatible chat and embeddings API
- Vitest for unit tests
- Playwright for end-to-end tests

## Setup

Install dependencies:

```bash
npm install
```

Apply database migrations:

```bash
npx prisma migrate dev
```

After setup, run the app with the commands below and configure credentials at `/settings`.

### Agent / parallel worktrees

Keep `main` as the integration checkout. For multi-step agent work, use a linked worktree and bootstrap it:

```bash
# from primary checkout on main
git worktree add -b feat-my-task ../xbook-feat-my-task main
cd ../xbook-feat-my-task
bash scripts/setup-worktree.sh
# optional: COPY_DB=1 bash scripts/setup-worktree.sh  # copy primary SQLite
npm run dev   # or PORT=3001 npm run dev if :3000 is taken
```

Cursor Agents run `scripts/setup-worktree.sh` automatically via `.cursor/worktrees.json`.

Do not commit worktree folders; `.worktrees/` is gitignored. Merge the feature branch back into `main` from the primary checkout after review, then `git worktree remove ../xbook-feat-my-task`.

## Run the App

Development:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

Production build:

```bash
npm run build
npm run start
```

Run on a different port:

```bash
npm run dev -- --port 3100
```

Playwright uses that same pattern and starts the app on `http://localhost:3100` during `npm run test:e2e`.

## Configuration

Settings are stored in the local database and can also fall back to environment variables.

Common environment variables:

```bash
DATABASE_URL="file:./dev.db"
OPENAI_BASE_URL="http://localhost:1234/v1"
OPENAI_API_KEY="lm-studio"
OPENAI_MODEL="your-model"
X_CLIENT_ID="..."
X_CLIENT_SECRET="..."
YT_CLIENT_ID="..."
YT_CLIENT_SECRET="..."
```

Legacy X bearer-token fields still exist in settings, but bookmark sync requires an OAuth user access token.

## OAuth Callback URLs

X:

```text
http://localhost:3000/api/x/oauth/callback
```

Suggested X scopes:

```text
tweet.read users.read bookmark.read offline.access
```

YouTube:

```text
http://localhost:3000/api/oauth/youtube/callback
```

The desktop app must use that URI. A stored loopback URI on another port (for example `:4010`) is rewritten to the live server origin. Google sign-in always opens in the system browser; the Tauri webview cannot complete Google OAuth.

## Local LLMs

The app uses the OpenAI SDK against an OpenAI-compatible endpoint. Typical defaults (also available as Settings → AI presets):

- LM Studio: `http://localhost:1234/v1` (concurrency 1)
- Ollama: `http://localhost:11434/v1` (concurrency 1)
- vLLM (localhost): `http://localhost:8000/v1` (concurrency 4; embeddings often on Ollama)
- REMOTE (high-concurrency LAN/remote vLLM example): `http://192.168.0.69:8000/v1`, model `gemma-4-26b`, concurrency up to **32**

Max parallel enrichment is `MAX_LLM_CONCURRENCY` (32) in `src/lib/llm-limits.ts`.

The configured model must be available at the selected endpoint before enrichment starts. The enrichment API runs a model availability check first and fails early if the model is not loaded.

## App Flow

1. Configure X, YouTube, and LLM settings in `/settings`.
2. Use the Dashboard to sync X or YouTube items.
3. Enrich pending items from the Dashboard, Library, or Folders workflows.
4. Review runs and failures in `/processing`.
5. Search, filter, edit, reprocess, and mark items read in `/bookmarks`.

## Data Model

The local SQLite database defaults to `dev.db`.

Important Prisma models:

- `Bookmark`: imported X posts and YouTube videos.
- `BookmarkFolder`: X folders and YouTube playlists.
- `Settings`: local credentials, API limits, model config, and UI preferences.
- `UsageMonth`: monthly import usage by source.
- `OperationRun`: sync and enrichment run summaries.
- `ProcessingEvent`: per-run and per-bookmark processing events.
- `LlmRequestLog`: prompt, response, usage, timing, and error records.

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
npm run test:crap
npx prisma migrate dev
```

Playwright starts its own dev server on `http://localhost:3100`.

## Product promo video (Remotion)

Programmatic product trailer lives in **`promo/trailer/`** (separate npm package, ~58s 1080p).

```bash
npm run promo:install   # once
npm run promo:studio    # visual editor / timeline
npm run promo:render    # out/xbook-trailer.mp4
```

Scenes and storyboard: [promo/trailer/README.md](promo/trailer/README.md).  
Composition ID: `XBookTrailer`. Optional real screenshots go in `promo/trailer/public/`.

## Desktop Application (Tauri)

XBook Console can be packaged as a standalone macOS desktop application using Tauri.

### Desktop Commands

To build the desktop application:
```bash
npm run build:desktop
npx tauri build
```
This will compile the Next.js production build, copy all backend assets (including Prisma migrations and the local Node.js binary), compile the Rust runner, and generate the final packaged `.app` bundle at `src-tauri/target/release/bundle/macos/xbook.app`.

### Under the Hood

- **Self-contained Server:** On startup, the desktop app spawns a hidden background Node.js server using the bundled node binary and a wrapper script (`start-server.js`).
- **OS Application Data:** The SQLite database is created and migrated automatically in the user's home directory (e.g. `~/.xbook/dev.db`) to prevent write failures inside the read-only application bundle.
- **Secure Auto-Updater:** The app checks for signed releases automatically on boot. Update payloads are signed and cryptographically verified using the public key configured in `tauri.conf.json`.
- **Default Browser OAuth:** OAuth logins launch in the default system browser to support existing sessions and prevent Google's embedded webview block, returning credentials back to the local app.

## Versioning and Releases

XBook Console versions are defined in:
1. `package.json` (`"version": "0.4.2"`)
2. `src-tauri/tauri.conf.json` (`"version": "0.4.2"`)
3. `src-tauri/Cargo.toml` (`version = "0.4.2"`)

User-facing history lives in [CHANGELOG.md](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/) style). Update the **Unreleased** section as you land work; fold it into a dated version heading when you cut a release.

Keep these three version fields in lockstep when cutting a release.

### Auto-updater

- `tauri.conf.json` has `bundle.createUpdaterArtifacts: true` and dual endpoints:
  1. `https://github.com/GINNOV/xbook/releases/latest/download/latest.json`
  2. `https://raw.githubusercontent.com/GINNOV/xbook/main/update.json` (fallback)
- Updates are minisign-verified with the public key in `plugins.updater.pubkey`.
- The repo is **public** so those HTTPS endpoints work unauthenticated (required for in-app updates).
- **Signing private key** (never commit):
  - 1Password: vault **GI Business**, item **XBook Console Tauri Update Keys**, tag `development`
  - Local mirror: `~/.tauri/xbook.key` (pubkey: `~/.tauri/xbook.key.pub`)
  - Load for builds:  
    `export TAURI_SIGNING_PRIVATE_KEY="$(op read 'op://GI Business/XBook Console Tauri Update Keys/Private key')"`
  - Losing the private key requires a new keypair, a pubkey bump in config, and a manual reinstall for existing users.
- Users on **0.3.0 or earlier** must install **0.4.0** once manually (signing key was rotated). From 0.4.0 onward, signed releases auto-update on Apple Silicon (`darwin-aarch64`).

### Cutting a desktop release (agent checklist)

**Triggers:** user says *cut a desktop release*, *ship desktop*, *release the app*, *publish desktop update*, or similar.

Do **not** only rebuild locally and stop. A release means: version bump → signed package → GitHub Release assets → `update.json` on `main` so installed apps can auto-update.

#### Prerequisites
- macOS Apple Silicon host (current updater manifest is `darwin-aarch64`).
- Isolated **worktree** for the release branch (see git-worktree rules); bootstrap with `bash scripts/setup-worktree.sh`.
- Signing key from 1Password (preferred) or `~/.tauri/xbook.key`:
  ```bash
  export TAURI_SIGNING_PRIVATE_KEY="$(op read 'op://GI Business/XBook Console Tauri Update Keys/Private key')"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  ```
- Never commit the private key. Never regenerate/replace the pubkey unless the user explicitly rotates keys (would force a manual reinstall for all users).

#### Steps (in order)
1. **Choose version** (semver):
   - patch (`0.4.x`) for fixes / small changes
   - minor (`0.x.0`) for user-facing features
   - major only if breaking
   - Must be **greater** than the last GitHub release tag (`xbook-v*`) and greater than `package.json` if already bumped.
2. **Bump in lockstep:**
   - `package.json` / `package-lock.json` root `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version` (and `Cargo.lock` app entry if present after build)
3. **CHANGELOG.md:** move `## [Unreleased]` bullets into `## [X.Y.Z] - YYYY-MM-DD`, add empty `## [Unreleased]`, add row to the release-tags table (`xbook-vX.Y.Z`).
4. **Build + sign + package:**
   ```bash
   npm run package:desktop
   # or: bash scripts/package-desktop-release.sh
   ```
   Expect under `dist-release/` (gitignored): `xbook.zip`, `xbook.app.tar.gz`, `xbook.app.tar.gz.sig`, `latest.json`.  
   Also writes repo-root **`update.json`** (commit this).
5. **Commit** on the release branch: version bumps, CHANGELOG, `update.json`, any packaging script fixes. Do not commit `dist-release/`, `src-tauri/target/`, or keys.
6. **Publish:**
   ```bash
   VERSION=$(node -p "require('./package.json').version")
   git tag -a "xbook-v${VERSION}" -m "xbook v${VERSION}"
   git push -u origin HEAD
   git push origin "xbook-v${VERSION}"
   gh release create "xbook-v${VERSION}" \
     dist-release/xbook.zip \
     dist-release/xbook.app.tar.gz \
     dist-release/xbook.app.tar.gz.sig \
     dist-release/latest.json \
     --title "xbook v${VERSION}" \
     --notes "See CHANGELOG.md for ${VERSION}."
   ```
7. **Land on `main`:** merge the release branch (or open PR and merge) so `update.json` and version files are on `main` (raw fallback endpoint).
8. **Verify auto-update endpoints (unauthenticated):**
   ```bash
   curl -sL -o /dev/null -w "%{http_code}\n" https://github.com/GINNOV/xbook/releases/latest/download/latest.json   # 200
   curl -sL -o /dev/null -w "%{http_code}\n" https://raw.githubusercontent.com/GINNOV/xbook/main/update.json           # 200
   ```
   Confirm JSON `version` matches the release and `platforms.darwin-aarch64.url` points at this tag’s tarball.
9. **Report to user:** release URL, version, that existing **0.4.0+** installs will prompt on next launch; remind that code on `main` alone does not update the desktop app until this process runs.

#### Do not
- Ship without bumping version (updater compares semver).
- Upload only `xbook.zip` (need `.tar.gz` + `.sig` + `latest.json` for auto-update).
- Leave `update.json` only on a feature branch (fallback endpoint reads `main`).
- Change `plugins.updater.pubkey` unless rotating keys on purpose.

#### Helpers
- `scripts/write-update-manifest.js` — regenerate manifests from an existing signed build only.
- `npm run package:desktop` — full signed package pipeline.

### Building and Signing Releases (CI/CD)
When deploying from CI:
1. Store the private key as `TAURI_SIGNING_PRIVATE_KEY` (and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
2. Prefer the official `tauri-apps/tauri-action` GitHub Action to build, sign, and upload macOS artifacts to GitHub Releases, including `latest.json`.

## Troubleshooting

If the app starts but fails with a `better_sqlite3.node` `NODE_MODULE_VERSION` error, rebuild the native SQLite dependency for your current Node version:

```bash
npm rebuild better-sqlite3
```

This usually happens after switching or upgrading Node.

## Project Structure

```text
src/app              Next.js pages, layouts, components, and route handlers
src/app/api          Import, enrichment, settings, OAuth, and processing APIs
src/app/components   UI components
src/app/hooks        Client-side UI hooks
src/app/lib          Server-side page fetchers and UI helpers
src/lib              Database, source fetchers, LLM, processing, settings
prisma               Schema and migrations
tests/unit           Vitest tests
tests/e2e            Playwright tests
```
