# Repository Guidelines

## Project Structure & Module Organization
- `src/app`: Next.js App Router pages, layouts, and API routes.
- `src/app/api`: Server endpoints (e.g., `/api/import`, `/api/enrich`).
- `src/lib`: Server-side helpers (X API fetcher, LLM client, DB access).
- `prisma/`: Prisma schema and migrations; SQLite database is `dev.db` in repo root.
- `public/`: Static assets.

## Build, Test, and Development Commands
- `npm run dev`: Start the local dev server.
- `npm run build`: Build the production bundle.
- `npm run start`: Run the production server (after build).
- `npm run lint`: Run ESLint.
- `npx prisma migrate dev`: Apply schema changes to the local SQLite DB.
- `npm run worktree:setup` / `bash scripts/setup-worktree.sh`: Bootstrap a git worktree (env copy, npm ci, Prisma). Prefer isolated worktrees for multi-step agent work; see `developer.md`.
- `npm run package:desktop`: Signed macOS desktop package + updater manifests (see below).

## Desktop releases (agent trigger)

When the user says **cut a desktop release**, **ship desktop**, **release the app**, **publish desktop update**, or equivalent:

1. Follow the full checklist in [developer.md → Cutting a desktop release (agent checklist)](developer.md#cutting-a-desktop-release-agent-checklist).
2. That means: semver bump (three version files + CHANGELOG), load signing key from 1Password (`op://GI Business/XBook Console Tauri Update Keys/Private key`) or `~/.tauri/xbook.key`, `npm run package:desktop`, commit `update.json` + version bumps, tag `xbook-vX.Y.Z`, `gh release create` with all `dist-release/*` assets, merge to **main**, verify public `latest.json` / `update.json` return 200.
3. Do **not** treat “push to main” or a local Next build as a desktop release. Installed apps only update from a **new signed GitHub release** with a higher version.

Details (auto-updater endpoints, key rotation, platform notes): [developer.md](developer.md#versioning-and-releases).

## Product promo video (Remotion)

When the user asks to **update the trailer**, **re-render promo**, or **edit the product video**:

1. Work in `promo/trailer/` (Remotion composition `XBookTrailer`).
2. Preview: `npm run promo:studio` (after `npm run promo:install` once).
3. Render MP4: `npm run promo:render` → `promo/trailer/out/xbook-trailer.mp4`.
4. See [promo/trailer/README.md](promo/trailer/README.md) for scene list and screenshot hooks.

Do not confuse this with a desktop release — the trailer is marketing source code, not the Tauri app.

## Coding Style & Naming Conventions
- Language: TypeScript with Next.js App Router.
- Indentation: 2 spaces; use double quotes in TS/TSX (matches existing code).
- File naming: `PascalCase` for components, `camelCase` for utilities.
- Linting: ESLint via `eslint-config-next`.

## Testing Guidelines
- No automated tests are configured yet. If you add tests, place them near the feature or in a `__tests__` folder and document the runner and command in this file.

## Commit & Pull Request Guidelines
- Commit messages in history are short, imperative sentences (e.g., "added hash system"). Follow that pattern unless you introduce a formal convention.
- PRs should include a clear summary, steps to validate, and screenshots for UI changes.

## Security & Configuration Tips
- Store secrets in `.env.local` (see `.env.local.example`).
- Required: `X_BEARER_TOKEN`, `X_USER_ID`, `OPENAI_MODEL`.
- LM Studio default endpoint is `http://localhost:1234/v1`.
- Ollama default OpenAI-compatible endpoint is `http://localhost:11434/v1`.
