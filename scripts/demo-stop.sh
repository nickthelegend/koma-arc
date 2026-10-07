#!/bin/sh
# Stops the app started by scripts/demo.sh (by PID only).
cd "$(dirname "$0")/.."
[ -f .data/web.pid ] && kill "$(cat .data/web.pid)" 2>/dev/null && echo "stopped web" || true
rm -f .data/web.pid
