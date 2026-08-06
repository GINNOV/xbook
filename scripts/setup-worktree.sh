#!/usr/bin/env bash
# Bootstrap a git worktree so it is as runnable as the primary XBook checkout.
# Usage (from inside the worktree, or after: git worktree add … && cd …):
#   bash scripts/setup-worktree.sh
#   COPY_DB=1 bash scripts/setup-worktree.sh   # also copy primary SQLite (optional)
#   SKIP_INSTALL=1 bash scripts/setup-worktree.sh
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

PRIMARY="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
if [[ "$PRIMARY" == "$ROOT" ]]; then
  echo "note: this is the primary checkout (integration tree)."
  echo "      Prefer running this script inside a linked worktree after:"
  echo "        git worktree add -b <task> ../xbook-<task> main"
fi

echo "==> Worktree:  $ROOT"
echo "==> Primary:   $PRIMARY"

copy_if_missing() {
  local name="$1"
  if [[ -f "$PRIMARY/$name" && ! -f "$ROOT/$name" ]]; then
    cp "$PRIMARY/$name" "$ROOT/$name"
    echo "    copied $name"
  fi
}

echo "==> Env files (copy, never symlink)"
for f in .env .env.local .env.development.local .env.test.local .env.development .env.test; do
  copy_if_missing "$f"
done

if [[ ! -f "$ROOT/.env.local" && ! -f "$ROOT/.env" ]]; then
  if [[ -f "$ROOT/.env.local.example" ]]; then
    cp "$ROOT/.env.local.example" "$ROOT/.env.local"
    echo "    seeded .env.local from .env.local.example"
  elif [[ -f "$ROOT/.env.example" ]]; then
    cp "$ROOT/.env.example" "$ROOT/.env.local"
    echo "    seeded .env.local from .env.example"
  else
    cat >"$ROOT/.env.local" <<'EOF'
# Worktree defaults — override as needed
DATABASE_URL="file:./dev.db"
EOF
    echo "    wrote minimal .env.local (DATABASE_URL=file:./dev.db)"
  fi
fi

# Ensure DATABASE_URL is set for Prisma CLI when only Settings DB is used at runtime
if ! grep -q '^DATABASE_URL=' "$ROOT/.env.local" 2>/dev/null && ! grep -q '^DATABASE_URL=' "$ROOT/.env" 2>/dev/null; then
  echo 'DATABASE_URL="file:./dev.db"' >>"$ROOT/.env.local"
  echo "    appended DATABASE_URL to .env.local"
fi

if [[ "${SKIP_INSTALL:-}" != "1" ]]; then
  echo "==> Dependencies"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  echo "==> Skipping npm install (SKIP_INSTALL=1)"
fi

echo "==> Prisma client + schema"
npx prisma generate

if [[ "${COPY_DB:-}" == "1" && -f "$PRIMARY/dev.db" && ! -f "$ROOT/dev.db" ]]; then
  echo "==> Copying primary SQLite (COPY_DB=1)"
  cp "$PRIMARY/dev.db" "$ROOT/dev.db"
  for side in dev.db-wal dev.db-shm dev.db-journal; do
    [[ -f "$PRIMARY/$side" ]] && cp "$PRIMARY/$side" "$ROOT/$side" || true
  done
elif [[ -f "$ROOT/dev.db" ]]; then
  echo "==> SQLite already present (dev.db)"
else
  echo "==> Fresh SQLite — applying migrations"
  DATABASE_URL="file:./dev.db" npx prisma migrate deploy
fi

# If DB exists but is empty/out of date, deploy is safe / no-op when current
if [[ -f "$ROOT/dev.db" ]]; then
  DATABASE_URL="file:./dev.db" npx prisma migrate deploy 2>/dev/null || true
fi

echo ""
echo "Worktree ready."
echo "  cd \"$ROOT\""
echo "  npm run dev          # default http://localhost:3000"
echo "  PORT=3001 npm run dev  # if primary already holds 3000"
echo ""
echo "Credentials still live in Settings (SQLite) when env fallbacks are empty."
echo "With a fresh DB, re-connect OAuth / LLM in the UI, or COPY_DB=1 next time."
