#!/usr/bin/env bash
set -euo pipefail

BASE=/opt/ihmod-admin
OUT=/var/backups/ihmod-admin
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$OUT"
sqlite3 "$BASE/data/admin.db" ".backup '$OUT/admin-$STAMP.db'"
tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$BASE/data" uploads
find "$OUT" -type f -mtime +14 -delete
