#!/bin/sh
# Start the KOMA indexer against koma-envio-pg / koma-envio-hasura.
#   sh scripts/start.sh        foreground        sh scripts/start.sh -r   re-index from the start block
set -e
cd "$(dirname "$0")/.."
. scripts/env.sh
docker inspect -f '{{.State.Health.Status}}' koma-envio-pg 2>/dev/null | grep -q healthy || { echo "koma-envio-pg isn't up: npm run db:up"; exit 1; }
docker inspect -f '{{.State.Health.Status}}' koma-envio-hasura 2>/dev/null | grep -q healthy || { echo "koma-envio-hasura isn't up: npm run db:up"; exit 1; }
exec ./node_modules/.bin/envio start "$@"
