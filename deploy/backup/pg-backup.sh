#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/dv/backups/pg}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-trientes}"
DB_USER="${DB_USER:-trientes}"
DB_HOST="${DB_HOST:-127.0.0.1}"

mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$BACKUP_DIR/${DB_NAME}-${TS}.sql.gz"

pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip -9 > "$FILE"

find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "[$(date -uIs)] backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
