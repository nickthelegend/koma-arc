#!/bin/sh
# Stops what `npm run demo` started, by recorded PID only (never by name: other projects may share this machine).
cd "$(dirname "$0")/.."
for f in web envio chain; do
  [ -f ".data/$f.pid" ] && kill "$(cat ".data/$f.pid")" 2>/dev/null && echo "stopped $f"
  rm -f ".data/$f.pid"
done
[ -f indexer/db.compose.yaml ] && command -v docker >/dev/null 2>&1 && (cd indexer && docker compose -f db.compose.yaml down >/dev/null 2>&1 && echo "stopped koma-envio-* containers")
exit 0
