#!/bin/sh
# Deploy KOMA's contracts to Arc.
#
#   sh scripts/deploy.sh testnet            # Arc testnet (5042002)
#   NETWORK=mainnet sh scripts/deploy.sh    # Arc mainnet (5042), see MAINNET.md
#   DRY_RUN=1 sh scripts/deploy.sh testnet  # simulate against the live chain, broadcast nothing
#
# One script for both networks (contracts/script/DeployLaunchpad.s.sol): the ERC-6551 registry + Tokenbound are
# replayed at their canonical addresses if missing, Uniswap v4 is deployed from Uniswap's artifacts, then KomaIssues
# and the launchpad. Addresses land in deployments/arc-<testnet|mainnet>.json.
#
# The deployer key is never stored in this repo: it is read from DEPLOYER_ENV (default ../.deployer/deployer.env,
# which defines DEPLOYER_PRIVATE_KEY) inside this process only. Broadcasts take the shared deployer lock so
# parallel deploys from the same wallet never collide on nonces.
#
# Env:
#   RELAYER        the KOMA server key's address (relays trades, settles x402, mints issues).
#                  Testnet default: SERVER_ADDRESS from .env.local (scripts/testnet-setup.sh writes it).
#   KOMA_PUBLIC_URL  public origin for token metadata (BASE_URI / KOMA_BASE_URI are derived from it)
#   mainnet only:  ADMIN (a Safe), TREASURY, RELAYER, KOMA_PUBLIC_URL, and CONFIRM_MAINNET=yes
#   VERIFY=1       verify every contract on the Arc explorer (Blockscout) after the broadcast
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
NETWORK=${1:-${NETWORK:-testnet}}
case "$NETWORK" in
  testnet) RPC=${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}; CHAIN=5042002; OUT=deployments/arc-testnet.json; EXPLORER=https://explorer.testnet.arc.io ;;
  mainnet) RPC=${ARC_MAINNET_RPC_URL:-https://rpc.mainnet.arc.io}; CHAIN=5042; OUT=deployments/arc-mainnet.json; EXPLORER=https://explorer.arc.io ;;
  *) echo "usage: sh scripts/deploy.sh testnet|mainnet"; exit 1 ;;
esac
OUT=${ADDRESSES_OUT:-$OUT}
command -v forge >/dev/null || { echo "missing: forge (https://getfoundry.sh)"; exit 1; }
[ -d node_modules/@uniswap/v4-core ] || npm ci --no-audit --no-fund
[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN" ] || { echo "$RPC is not chain $CHAIN"; exit 1; }

val() { [ -f .env.local ] && grep "^$1=" .env.local | tail -1 | cut -d= -f2- || true; }
RELAYER=${RELAYER:-$(val SERVER_ADDRESS)}
PUBLIC_URL=${KOMA_PUBLIC_URL:-$(val KOMA_PUBLIC_URL)}
PUBLIC_URL=${PUBLIC_URL:-http://localhost:4310}
[ -n "$RELAYER" ] || { echo "Set RELAYER (the server key's address), or run scripts/testnet-setup.sh first."; exit 1; }

if [ "$NETWORK" = mainnet ]; then
  for v in ADMIN TREASURY; do eval "[ -n \"\$$v\" ]" || { echo "mainnet needs $v (see MAINNET.md)"; exit 1; }; done
  case "$PUBLIC_URL" in *localhost*|*127.0.0.1*) echo "mainnet needs KOMA_PUBLIC_URL (the hosted app's origin)"; exit 1 ;; esac
  [ -n "$DRY_RUN" ] || [ "$CONFIRM_MAINNET" = yes ] || { echo "Mainnet holds real money. Re-run with CONFIRM_MAINNET=yes."; exit 1; }
fi

DEPLOYER_ENV=${DEPLOYER_ENV:-$ROOT/../.deployer/deployer.env}
[ -f "$DEPLOYER_ENV" ] || { echo "No deployer key file at $DEPLOYER_ENV (set DEPLOYER_ENV)."; exit 1; }
set -a; . "$DEPLOYER_ENV"; set +a
[ -n "$DEPLOYER_PRIVATE_KEY" ] || { echo "$DEPLOYER_ENV doesn't define DEPLOYER_PRIVATE_KEY"; exit 1; }

# forge writes the addresses during simulation, before broadcasting: write to .pending, move into place on success.
export RELAYER BASE_URI="$PUBLIC_URL/api/characters/" KOMA_BASE_URI="$PUBLIC_URL/api/tokens/" ADDRESSES_OUT="$ROOT/$OUT.pending"
case "$OUT" in /*) ADDRESSES_OUT=$OUT.pending ;; esac
mkdir -p deployments
cd contracts
run() {
  DEPLOYER_KEY="$DEPLOYER_PRIVATE_KEY" forge script script/DeployLaunchpad.s.sol --rpc-url "$RPC" --slow "$@"
}
if [ -n "$DRY_RUN" ]; then
  ADDRESSES_OUT=none run
  exit 0
fi

# Shared deployer wallet: hold the lock only for the broadcast.
LOCK="$ROOT/../.deployer/lock"
until mkdir "$LOCK" 2>/dev/null; do echo "waiting for the deployer lock…"; sleep 3; done
trap 'rmdir "$LOCK" 2>/dev/null; rm -f "$ADDRESSES_OUT"' EXIT
run --broadcast
rmdir "$LOCK"; trap - EXIT
cd "$ROOT"
mv "$ADDRESSES_OUT" "$OUT"
# Record what the deploy cost and its transactions next to the addresses (receipts from forge's broadcast log).
node -e '
const fs = require("fs");
const [out, log] = process.argv.slice(1);
const d = JSON.parse(fs.readFileSync(out, "utf8"));
const b = JSON.parse(fs.readFileSync(log, "utf8"));
let gas = 0n, wei = 0n;
for (const r of b.receipts) { gas += BigInt(r.gasUsed); wei += BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice); }
d.deployGas = { transactions: b.receipts.length, gasUsed: gas.toString(), usdc: (Number(wei) / 1e18).toFixed(6) };
d.deployTxs = b.receipts.map((r) => r.transactionHash);
fs.writeFileSync(out, JSON.stringify(d, null, 2) + "\n");
console.log(`deploy: ${b.receipts.length} txs, ${gas} gas, ${d.deployGas.usdc} USDC`);
' "$OUT" "contracts/broadcast/DeployLaunchpad.s.sol/$CHAIN/run-latest.json"
echo "addresses: $OUT"

if [ -n "$VERIFY" ]; then sh scripts/verify.sh "$NETWORK"; fi
echo "explorer: $EXPLORER/address/$(node -e "console.log(require(require('path').resolve('$OUT')).seriesFactory)")"
