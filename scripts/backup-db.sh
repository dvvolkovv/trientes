#!/usr/bin/env bash
# Daily Postgres backup for Trientes.
#
# - Dumps DATABASE_URL with pg_dump (custom format) + gzip
# - Keeps last 14 daily dumps under $BACKUP_ROOT/daily/
# - On the 1st of each month also copies the dump into $BACKUP_ROOT/monthly/
#   and keeps the last 12 monthly snapshots
#
# Install (on the server):
#   sudo mkdir -p /var/log/trientes && sudo chown dv:dv /var/log/trientes
#   crontab -e   # add:  15 3 * * * /home/dv/trientes/scripts/backup-db.sh
#
# Override BACKUP_ROOT by exporting it before invoking.

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/home/dv/backups/trientes}"
APP_DIR="${APP_DIR:-/home/dv/trientes}"
KEEP_DAILY=14
KEEP_MONTHLY=12
LOG_FILE="${LOG_FILE:-/var/log/trientes/backup.log}"

log() {
  local line="[$(date -u +%FT%TZ)] $*"
  echo "$line"
  if [[ -w "$(dirname "$LOG_FILE")" ]] || [[ -w "$LOG_FILE" 2>/dev/null ]]; then
    echo "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

trap 'log "ERROR backup failed at line $LINENO (exit $?)"' ERR

# Load DATABASE_URL from the app's .env (server has the real creds there).
if [[ -f "$APP_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$APP_DIR/.env"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  log "DATABASE_URL not set; aborting"
  exit 1
fi

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/monthly"

DATE=$(date -u +%Y-%m-%d)
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
OUT="$BACKUP_ROOT/daily/trientes-${TS}.dump.gz"
TMP="${OUT}.partial"

log "starting dump → $OUT"
# Custom format (-Fc) is smaller and supports parallel restore. Pipe through gzip.
pg_dump --no-owner --no-privileges -Fc "$DATABASE_URL" | gzip -9 > "$TMP"
mv "$TMP" "$OUT"
SIZE=$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")
log "dump ok: $OUT ($SIZE bytes)"

# Daily retention: delete dumps older than KEEP_DAILY days.
find "$BACKUP_ROOT/daily" -maxdepth 1 -type f -name 'trientes-*.dump.gz' -mtime +$KEEP_DAILY -print -delete | while read -r f; do
  log "pruned daily: $f"
done

# Monthly snapshot on the 1st (UTC).
if [[ "$(date -u +%d)" == "01" ]]; then
  MONTHLY="$BACKUP_ROOT/monthly/trientes-${DATE}.dump.gz"
  cp "$OUT" "$MONTHLY"
  log "monthly snapshot: $MONTHLY"
fi

# Monthly retention: keep newest KEEP_MONTHLY files.
mapfile -t MONTHLIES < <(ls -1t "$BACKUP_ROOT/monthly"/trientes-*.dump.gz 2>/dev/null || true)
if (( ${#MONTHLIES[@]} > KEEP_MONTHLY )); then
  for f in "${MONTHLIES[@]:$KEEP_MONTHLY}"; do
    rm -f "$f"
    log "pruned monthly: $f"
  done
fi

log "done"
