#!/bin/sh
# One-time setup for the local Monad testnet fork (npm run chain, then this).
#  1. Creates .env.local with fresh local-only keys if it doesn't exist (public anvil keys are swept on Monad).
#  2. Deploys the whole launchpad with the real deploy script, Uniswap v4 included (Monad testnet has none).
#  3. Funds the server with MON and the test wallets with real AUSD from Agora's faucet contract.
set -e
cd "$(dirname "$0")/.."
RPC=http://127.0.0.1:$(grep '^KOMA_CHAIN_PORT=' .env.local 2>/dev/null | cut -d= -f2 || true)
[ "$RPC" = "http://127.0.0.1:" ] && RPC=http://127.0.0.1:18643
AUSD=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
AGORA_FAUCET=0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C

if [ ! -f .env.local ]; then
  key() { cast wallet new --json | node -e 'const w=JSON.parse(require("fs").readFileSync(0,"utf8"))[0];console.log(w.private_key+" "+w.address)'; }
  set -- $(key); SK=$1; SA=$2
  set -- $(key); BK=$1; BA=$2
  set -- $(key); AK=$1; AA=$2
  set -- $(key); EK=$1; EA=$2
  set -- $(key); PK=$1; PA=$2
  cat > .env.local <<ENV
NEXT_PUBLIC_KOMA_NETWORK=koma-localnet
NEXT_PUBLIC_MONAD_RPC_URL=$RPC
KOMA_CHAIN_PORT=18643
KOMA_FORK_BLOCK=$(cast block-number --rpc-url https://testnet-rpc.monad.xyz)
KOMA_PUBLIC_URL=http://localhost:4320
KOMA_LAUNCHPAD_ADDRESSES=.data/addresses.local.json
SERVER_PRIVATE_KEY=$SK
SERVER_ADDRESS=$SA
KOMA_CONTRACT=
KOMA_PAY_TO=
TEST_BROWSER_KEY=$BK
TEST_BROWSER_ADDRESS=$BA
TEST_AGENT_KEY=$AK
TEST_AGENT_ADDRESS=$AA
TEST_EMPTY_KEY=$EK
TEST_EMPTY_ADDRESS=$EA
TEST_PAYTO_KEY=$PK
TEST_PAYTO_ADDRESS=$PA
ENV
  echo "wrote .env.local with fresh local keys (restart scripts/chain.sh so it pins KOMA_FORK_BLOCK)"
fi
[ "$KOMA_SETUP_ENV_ONLY" = "1" ] && exit 0
val() { grep "^$1=" .env.local | cut -d= -f2-; }
SERVER=$(val SERVER_ADDRESS)
SERVER_KEY=$(val SERVER_PRIVATE_KEY)
TREASURY=$(val TEST_PAYTO_ADDRESS)

for a in "$SERVER" "$(val TEST_BROWSER_ADDRESS)" "$(val TEST_AGENT_ADDRESS)" "$(val TEST_EMPTY_ADDRESS)" "$TREASURY"; do
  [ "$(cast code "$a" --rpc-url $RPC)" = "0x" ] || { echo "$a has code; use a fresh key"; exit 1; }
  cast rpc anvil_setBalance "$a" 0x56BC75E2D63100000 --rpc-url $RPC > /dev/null   # 100 MON (local fork only)
done

# The whole suite, exactly as on Monad testnet: AUSD from the book, Uniswap v4 deployed by the script.
ORIGIN=$(val KOMA_PUBLIC_URL)
(cd contracts && DEPLOYER_KEY=$SERVER_KEY ALLOW_EOA_ADMIN=true TREASURY=$TREASURY RELAYER=$SERVER \
  BASE_URI=$ORIGIN/api/characters/ KOMA_BASE_URI=$ORIGIN/api/tokens/ \
  ADDRESSES_OUT=../.data/addresses.local.json \
  forge script script/DeployLaunchpad.s.sol --rpc-url $RPC --broadcast --slow > ../.data/deploy.log 2>&1) || { tail -30 .data/deploy.log; exit 1; }
ISSUES=$(node -e 'console.log(require("./.data/addresses.local.json").komaIssues)')
sed -i '' "s#^KOMA_CONTRACT=.*#KOMA_CONTRACT=$ISSUES#; s#^KOMA_PAY_TO=.*#KOMA_PAY_TO=$TREASURY#" .env.local
echo "launchpad deployed (.data/addresses.local.json); KomaIssues $ISSUES"

# Chainlink CRE receiver for canon settlement, on Monad testnet's MockKeystoneForwarder (what `cre workflow
# simulate --broadcast` and cre/koma-canon/fork-settle.ts deliver through); adds canonSettler to the book.
(cd contracts && ADDRESSES=../.data/addresses.local.json DEPLOYER_KEY=$SERVER_KEY \
  forge script script/DeployCanonSettler.s.sol --rpc-url $RPC --broadcast --slow >> ../.data/deploy.log 2>&1) || { tail -30 .data/deploy.log; exit 1; }
node -e '
const fs = require("fs"), a = require("./.data/addresses.local.json"), p = "cre/koma-canon/config.local-fork.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
Object.assign(c, { canonRegistry: a.canonRegistry, receiver: a.canonSettler });
fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
console.log("CanonSettler " + a.canonSettler + " (cre/koma-canon/config.local-fork.json updated)");'

# Real AUSD, moved out of Agora's faucet contract (it holds ~1B test AUSD) — local fork only.
cast rpc anvil_setBalance $AGORA_FAUCET 0x56BC75E2D63100000 --rpc-url $RPC > /dev/null
cast rpc anvil_impersonateAccount $AGORA_FAUCET --rpc-url $RPC > /dev/null
fund() {
  cast send $AUSD 'transfer(address,uint256)' "$1" "$2" --from $AGORA_FAUCET --unlocked --rpc-url $RPC > /dev/null
  echo "$1 → $(cast call $AUSD 'balanceOf(address)(uint256)' "$1" --rpc-url $RPC) AUSD units"
}
fund "$(val TEST_BROWSER_ADDRESS)" 200000000
fund "$(val TEST_AGENT_ADDRESS)" 200000000
cast rpc anvil_stopImpersonatingAccount $AGORA_FAUCET --rpc-url $RPC > /dev/null
