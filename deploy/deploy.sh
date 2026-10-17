#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${SERVICE:-edunest-backend}"
FRONTEND_DIR="${FRONTEND_DIR:-$HOME/EduNest}"
WEB_ROOT="${WEB_ROOT:-/var/www/edunest}"

cd "$APP_DIR"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

env_value() {
  node -e "require('dotenv').config({ quiet: true }); process.stdout.write((process.env['$1'] ?? '').trim())"
}

db_part() {
  node -e "require('dotenv').config({ quiet: true }); const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent($1))"
}

git diff --quiet && git diff --cached --quiet || fail "backend has uncommitted changes"

BACKUP_DIR="$(env_value BACKUP_DIR)"
[ -n "$BACKUP_DIR" ] || fail "BACKUP_DIR is not set in .env"
CONTAINER="$(env_value BACKUP_PG_CONTAINER)"
CONTAINER="${CONTAINER:-edu_postgres}"
DB_USER="$(db_part u.username)"
DB_NAME="$(db_part "u.pathname.slice(1)")"

echo "==> Safety copy"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/edu_db_$(TZ=Europe/Kyiv date +%Y-%m-%d_%H%M%S)_manual.dump"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc '--exclude-table-data="BackupRun"' > "$FILE.part"
mv "$FILE.part" "$FILE"
echo "    $FILE"

echo "==> Backend"
git pull --ff-only
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
sudo systemctl restart "$SERVICE"

PORT="$(env_value PORT)"
PORT="${PORT:-3000}"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/auth/me"; then
    STARTED=1
    break
  fi
  sleep 2
done
[ "${STARTED:-}" = 1 ] || fail "backend did not start, check: journalctl -u $SERVICE -n 100"

if [ -d "$FRONTEND_DIR" ]; then
  echo "==> Frontend"
  cd "$FRONTEND_DIR"
  git diff --quiet && git diff --cached --quiet || fail "frontend has uncommitted changes"
  git pull --ff-only
  npm ci
  npm run build
  sudo rsync -a --delete dist/ "$WEB_ROOT/"
fi

echo "==> Done"
