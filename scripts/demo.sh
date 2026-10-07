#!/bin/sh
# KOMA locally against Arc testnet, one command:
#   npm run demo          (stop with: npm run demo:stop)
# Uses the contracts in deployments/arc-testnet.json, creates local test keys in .env.local on first run
# (scripts/testnet-setup.sh), builds the app and serves it on http://localhost:4310.
# AI: put FAL_KEY in .env.local (Kimi + Hunyuan through fal, art on fal), or MOONSHOT_API_KEY + HUNYUAN_API_KEY + FAL_KEY.
# Without AI keys the studio says it isn't configured; trading, voting and the room still work.
set -e
cd "$(dirname "$0")/.."
mkdir -p .data
say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
[ -f deployments/arc-testnet.json ] || { echo "No deployments/arc-testnet.json: deploy first (sh scripts/deploy.sh testnet)."; exit 1; }
grep -q '^SERVER_PRIVATE_KEY=' .env.local 2>/dev/null || { say "Creating local test keys in .env.local"; FUND=0 sh scripts/testnet-setup.sh; }
say "Building the app"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx next build > .data/build.log 2>&1 || { tail -30 .data/build.log; exit 1; }
[ -f .data/web.pid ] && kill "$(cat .data/web.pid)" 2>/dev/null || true
say "Serving http://localhost:4310 (Arc testnet)"
( set -a; . ./.env.local; set +a; nohup npx next start -p 4310 > .data/web.log 2>&1 & echo $! > .data/web.pid )
i=0; until curl -sf -o /dev/null http://localhost:4310/api/status; do i=$((i+1)); [ $i -gt 60 ] && { tail -20 .data/web.log; exit 1; }; sleep 1; done
curl -s http://localhost:4310/api/status | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("  ready:",s.ready,"· chain:",s.chainId,"· relayer:",s.relayerUsdc,"USDC · AI:",s.ai.configured?`${s.ai.script} / ${s.ai.editor} / ${s.ai.image}`:`not configured (${s.ai.missing.join("; ")})`)'
cat <<MSG

  KOMA is up: http://localhost:4310 on Arc testnet
  Test USDC (also the gas token): https://faucet.circle.com → Arc Testnet
  Tests: npm run test:api · test:launchpad · test:browser · test:walk · test:ai · test:room
  Stop:  npm run demo:stop
MSG
