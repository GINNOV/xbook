#!/usr/bin/env bash
# Build a signed macOS desktop release and prepare GitHub release assets.
#
# Prerequisites:
#   - Rust + Node toolchains
#   - TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH (or ~/.tauri/xbook.key)
#   - Optional: TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#   - Preferred key source (agents): 1Password GI Business item
#       op read 'op://GI Business/XBook Console Tauri Update Keys/Private key'
#   - Full release process: developer.md → "Cutting a desktop release (agent checklist)"
#     and AGENTS.md → "Desktop releases (agent trigger)"
#
# Usage:
#   bash scripts/package-desktop-release.sh
#   # after version bump + CHANGELOG fold; this only packages — still publish + merge main
#
# Outputs under dist-release/:
#   - xbook.app.tar.gz (+ .sig)
#   - xbook.zip          (manual install of the .app)
#   - latest.json        (updater manifest)
# Also writes update.json at repo root for the main-branch fallback endpoint.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/xbook.key}"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -f "$KEY_PATH" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
    echo "Using signing key from $KEY_PATH"
  else
    echo "error: set TAURI_SIGNING_PRIVATE_KEY or place the private key at $KEY_PATH" >&2
    exit 1
  fi
fi

export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

VERSION="$(node -p "require('./package.json').version")"
echo "==> Building desktop app v${VERSION}"
echo "    (tauri beforeBuildCommand runs npm run build:desktop)"

npx tauri build

MACOS_DIR="$ROOT/src-tauri/target/release/bundle/macos"
APP="$MACOS_DIR/xbook.app"
TAR="$MACOS_DIR/xbook.app.tar.gz"
SIG="$MACOS_DIR/xbook.app.tar.gz.sig"

if [[ ! -d "$APP" ]]; then
  echo "error: expected app bundle at $APP" >&2
  exit 1
fi
if [[ ! -f "$TAR" || ! -f "$SIG" ]]; then
  echo "error: missing updater artifacts (.tar.gz / .sig). Is createUpdaterArtifacts true and signing key set?" >&2
  exit 1
fi

OUT="$ROOT/dist-release"
rm -rf "$OUT"
mkdir -p "$OUT"

# Manual install zip (same shape as prior releases)
(
  cd "$MACOS_DIR"
  ditto -c -k --sequesterRsrc --keepParent xbook.app "$OUT/xbook.zip"
)

cp "$TAR" "$OUT/"
cp "$SIG" "$OUT/"

# Writes dist-release/latest.json and repo-root update.json
node "$ROOT/scripts/write-update-manifest.js"

echo ""
echo "==> Release assets ready in dist-release/"
ls -lh "$OUT"
echo ""
echo "Next steps:"
echo "  1. Commit version bump + update.json on the release branch"
echo "  2. gh release create xbook-v${VERSION} \\"
echo "       dist-release/xbook.zip dist-release/xbook.app.tar.gz \\"
echo "       dist-release/xbook.app.tar.gz.sig dist-release/latest.json \\"
echo "       --title \"xbook v${VERSION}\" --notes-from-tag"
echo "  3. Merge to main so raw update.json endpoint stays in sync"
