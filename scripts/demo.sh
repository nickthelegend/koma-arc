#!/bin/sh
# One command, the whole of KOMA on a local fork of Monad testnet:
#   npm run demo          (stop everything with: npm run demo:stop)
# Starts the anvil fork (:18643), deploys the launchpad + Uniswap v4 + the CRE canon settler with the real deploy
# scripts on first run, funds test wallets with Agora's real AUSD, starts the Envio indexer (when Docker and Node 22
# are available), then builds and serves the app on http://localhost:4320. Processes are recorded in .data/*.pid and
# stopped by PID only.
#
# Needs: Node >= 22.13, Foundry (anvil/forge/cast), Bun (CRE workflow), Docker (optional: Envio).
# AI: put FAL_KEY in .env.local (Kimi + Hunyuan through fal, art on fal), or MOONSHOT_API_KEY + HUNYUAN_API_KEY + FAL_KEY.
# Without AI keys the studio says it isn't configured; trading, launches of existing art, voting and the room work.
set -e
cd "$(dirname "$0")/.."
mkdir -p .data
say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 ($2)"; exit 1; }; }
need node "Node 22.13+"; need anvil "Foundry: https://getfoundry.sh"; need forge Foundry; need cast Foundry
up() { curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$1"; }

# 1. Keys (fresh, local-only) and the fork block.
[ -f .env.local ] || { say "Creating .env.local with fresh local keys"; KOMA_SETUP_ENV_ONLY=1 sh scripts/local-setup.sh; }
val() { grep "^$1=" .env.local | cut -d= -f2-; }
RPC=http://127.0.0.1:$(val KOMA_CHAIN_PORT); [ "$RPC" = "http://127.0.0.1:" ] && RPC=http://127.0.0.1:18643

# 2. The chain.
if ! up "$RPC"; then
  say "Starting the Monad testnet fork on $RPC"
  nohup sh scripts/chain.sh > .data/chain.log 2>&1 & echo $! > .data/chain.pid
  i=0; until up "$RPC"; do i=$((i+1)); [ $i -gt 60 ] && { tail -20 .data/chain.log; exit 1; }; sleep 1; done
fi

# 3. Contracts (first run, or after the chain state was reset).
FACTORY=$(node -e 'try{console.log(require("./.data/addresses.local.json").seriesFactory)}catch{}')
if [ -z "$FACTORY" ] || [ "$(cast code "$FACTORY" --rpc-url "$RPC")" = "0x" ]; then
  say "Deploying KOMA (launchpad, Uniswap v4, CanonSettler) with the real deploy scripts"
  sh scripts/local-setup.sh
fi

# 4. Envio (optional).
ENVIO_URL=""
NODE22=$(ls -d "$HOME"/.nvm/versions/node/v22.*/bin 2>/dev/null | tail -1)
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && [ -n "$NODE22" ]; then
  say "Starting the Envio indexer (koma-envio-* containers, GraphQL on :8093)"
  ( cd indexer && export PATH="$NODE22:$PATH" && { [ -d node_modules ] || npm install --no-audit --no-fund >/dev/null; } \
    && node gen-config.mjs local >/dev/null && ./node_modules/.bin/envio codegen >/dev/null && npm run -s db:up >/dev/null 2>&1 )
  if [ ! -f .data/envio.pid ] || ! kill -0 "$(cat .data/envio.pid)" 2>/dev/null; then
    ( cd indexer || exit 1
      PATH="$NODE22:$PATH" nohup sh scripts/start.sh -r > ../.data/envio.log 2>&1 &
      echo $! > ../.data/envio.pid )
  fi
  ENVIO_URL=http://localhost:8093/v1/graphql
else
  echo "  (Envio skipped: needs Docker and Node 22 via nvm. The leaderboard falls back to KOMA's own index.)"
fi

# 5. The app.
say "Building the app"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx next build > .data/build.log 2>&1 || { tail -30 .data/build.log; exit 1; }
[ -f .data/web.pid ] && kill "$(cat .data/web.pid)" 2>/dev/null || true
say "Serving http://localhost:4320"
( set -a; . ./.env.local; set +a
  ENVIO_GRAPHQL_URL=$ENVIO_URL KOMA_CANON_FINALIZER=cre KOMA_DATA_DIR=.data KOMA_LAUNCHPAD_ADDRESSES=.data/addresses.local.json \
  nohup npx next start -p 4320 > .data/web.log 2>&1 & echo $! > .data/web.pid )
i=0; until curl -sf -o /dev/null http://localhost:4320/api/status; do i=$((i+1)); [ $i -gt 60 ] && { tail -20 .data/web.log; exit 1; }; sleep 1; done
curl -s http://localhost:4320/api/status | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("  ready:",s.ready,"· AI:",s.ai.configured?`${s.ai.script} / ${s.ai.editor} / ${s.ai.image}`:`not configured (${s.ai.missing.join("; ")})`)'
cat <<MSG

  KOMA is up: http://localhost:4320   (chain $RPC${ENVIO_URL:+ · Envio $ENVIO_URL})
  Test wallets and their keys are in .env.local (local fork only). Get AUSD in the app with "Get 10,000 test AUSD".
  Tests: npm run test:walk · test:browser · test:api · test:launchpad · test:cre · test:envio · test:room
  Stop:  npm run demo:stop
MSG
