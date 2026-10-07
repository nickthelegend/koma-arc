#!/bin/sh
# Arc testnet setup for running KOMA locally against the real chain.
#
#   sh scripts/testnet-setup.sh          # keys into .env.local (first run), then fund them from the deployer
#   FUND=0 sh scripts/testnet-setup.sh   # keys only
#
# 1. Creates fresh, local-only keys in .env.local (gitignored) unless they already exist:
#      SERVER_PRIVATE_KEY  KOMA's server: x402 facilitator, trade relayer, canon keeper, issue minter
#      TEST_BROWSER_KEY    a reader/creator wallet the e2e suites sign with (payments, trades, votes)
#      TEST_AGENT_KEY      a second holder (an AI agent paying with x402 from a script)
#    These hold testnet USDC only. Never reuse them anywhere else.
# 2. Tops them up with testnet USDC (the gas token too) from the deployer wallet, under the shared deployer lock.
#    The deployer gets its USDC from https://faucet.circle.com (Arc Testnet).
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
RPC=${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}
USDC=0x3600000000000000000000000000000000000000
touch .env.local
val() { grep "^$1=" .env.local | tail -1 | cut -d= -f2-; }
put() { grep -q "^$1=" .env.local || printf '%s=%s\n' "$1" "$2" >> .env.local; }

# newkey <KEY var> <ADDRESS var>: a fresh key, written once; the key itself is never printed.
newkey() {
  if [ -z "$(val "$1")" ]; then
    json=$(cast wallet new --json)
    key=$(printf '%s' "$json" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8"))[0].private_key)')
    addr=$(printf '%s' "$json" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8"))[0].address)')
    printf '%s=%s\n%s=%s\n' "$1" "$key" "$2" "$addr" >> .env.local
    echo "created $2 $addr"
  fi
}

put NEXT_PUBLIC_KOMA_NETWORK arc-testnet
put KOMA_PUBLIC_URL http://localhost:4310
put KOMA_LAUNCHPAD_ADDRESSES deployments/arc-testnet.json
newkey SERVER_PRIVATE_KEY SERVER_ADDRESS
newkey TEST_BROWSER_KEY TEST_BROWSER_ADDRESS
newkey TEST_AGENT_KEY TEST_AGENT_ADDRESS
put KOMA_PAY_TO "$(val SERVER_ADDRESS)"

[ "${FUND:-1}" = 0 ] && exit 0

DEPLOYER_ENV=${DEPLOYER_ENV:-$ROOT/../.deployer/deployer.env}
[ -f "$DEPLOYER_ENV" ] || { echo "No deployer key at $DEPLOYER_ENV; fund these addresses from https://faucet.circle.com instead."; exit 0; }
set -a; . "$DEPLOYER_ENV"; set +a
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
bal() { cast call "$USDC" "balanceOf(address)(uint256)" "$1" --rpc-url "$RPC" | cut -d' ' -f1; }
echo "deployer $DEPLOYER: $(bal "$DEPLOYER") (6-dec USDC)"

# target balances in USDC units (6 decimals)
fund() {
  who=$1; want=$2
  have=$(bal "$who")
  [ "$have" -ge "$want" ] && { echo "  $who has $have, ok"; return; }
  need=$((want - have))
  LOCK="$ROOT/../.deployer/lock"
  until mkdir "$LOCK" 2>/dev/null; do sleep 3; done
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
  cast send "$USDC" "transfer(address,uint256)" "$who" "$need" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null
  rmdir "$LOCK"; trap - EXIT
  echo "  $who topped up by $need → $(bal "$who")"
}
fund "$(val SERVER_ADDRESS)" "${SERVER_USDC:-4000000}"
fund "$(val TEST_BROWSER_ADDRESS)" "${BROWSER_USDC:-8000000}"
fund "$(val TEST_AGENT_ADDRESS)" "${AGENT_USDC:-2000000}"
