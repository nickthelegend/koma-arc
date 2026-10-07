#!/bin/sh
# Local Monad testnet: a pinned anvil fork (real AUSD, Tokenbound, Permit2) on port 18643, saved to
# .data/chain.json so it survives restarts along with koma.db. anvil rewrites that file in place every few
# seconds, so a kill mid-write leaves it truncated: keep the last good copy and fall back to it.
set -e
cd "$(dirname "$0")/.."
val() { grep "^$1=" .env.local | cut -d= -f2-; }
BLOCK=$(val KOMA_FORK_BLOCK)
PORT=$(val KOMA_CHAIN_PORT); PORT=${PORT:-18643}
mkdir -p .data
STATE=.data/chain.json
if [ -s "$STATE" ]; then
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$STATE" 2>/dev/null; then
    cp "$STATE" "$STATE.bak"
  elif [ -s "$STATE.bak" ]; then
    echo "chain: $STATE is damaged (interrupted save); restoring $STATE.bak" >&2
    cp "$STATE.bak" "$STATE"
  else
    echo "chain: $STATE is damaged and there is no backup" >&2
    exit 1
  fi
fi
# Upstream: KOMA_FORK_RPC (an Alchemy Monad testnet URL works) or the public Monad testnet RPC.
FORK_RPC=$(val KOMA_FORK_RPC)
exec anvil --fork-url "${FORK_RPC:-https://testnet-rpc.monad.xyz}" ${BLOCK:+--fork-block-number "$BLOCK"} \
  --port "$PORT" --block-time 1 --prune-history 300 --state "$STATE" --state-interval 5 --silent
