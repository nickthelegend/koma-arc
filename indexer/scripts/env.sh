# shellcheck shell=sh
# Sourced by start.sh: points `envio start` at koma-envio-pg / koma-envio-hasura (db.compose.yaml) instead of the
# fixed-name containers `envio dev` would create or reuse. Every value can be overridden from the environment.
export ENVIO_PG_HOST="${ENVIO_PG_HOST:-127.0.0.1}"
export ENVIO_PG_PORT="${ENVIO_PG_PORT:-${KOMA_ENVIO_PG_PORT:-55443}}"
export ENVIO_PG_USER="${ENVIO_PG_USER:-postgres}"
export ENVIO_PG_PASSWORD="${ENVIO_PG_PASSWORD:-${KOMA_ENVIO_PG_PASSWORD:-koma-envio-local}}"
export ENVIO_PG_DATABASE="${ENVIO_PG_DATABASE:-envio-dev}"
export ENVIO_PG_SCHEMA="${ENVIO_PG_SCHEMA:-public}"
export HASURA_EXTERNAL_PORT="${HASURA_EXTERNAL_PORT:-${KOMA_ENVIO_HASURA_PORT:-8093}}"
export HASURA_GRAPHQL_ENDPOINT="${HASURA_GRAPHQL_ENDPOINT:-http://localhost:${HASURA_EXTERNAL_PORT}/v1/metadata}"
export HASURA_GRAPHQL_ADMIN_SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-${KOMA_ENVIO_HASURA_SECRET:-koma-admin}}"
export ENVIO_INDEXER_PORT="${ENVIO_INDEXER_PORT:-9893}"
