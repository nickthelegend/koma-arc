#!/bin/sh
# Rehearse everything locally on a fork of Arc testnet, without spending testnet USDC.
#
#   ARC_ANVIL=/path/to/arc-anvil sh scripts/local-fork.sh
#
# Needs Arc Foundry's `arc-anvil` (https://github.com/circlefin/arc-foundry/releases): plain anvil can fork Arc but
# can't move Arc's native USDC (transfers through 0x3600…0000 revert), arc-anvil (`--network arc`) can.
# 1. Starts arc-anvil forking Arc testnet on :18645 with 1-second blocks (canon windows run on block time).
# 2. Deploys with the real deploy script into deployments/local-fork.json (gitignored), anvil's key 0 as deployer.
# 3. Gives the .env.local wallets USDC by setting their native balance (it is the same USDC).
# Then run the app against it:
#   NEXT_PUBLIC_ARC_RPC_URL=http://127.0.0.1:18645 npx next build
#   NEXT_PUBLIC_ARC_RPC_URL=http://127.0.0.1:18645 KOMA_LAUNCHPAD_ADDRESSES=deployments/local-fork.json KOMA_DATA_DIR=.data.fork npx next start -p 4310
#   KOMA_RPC=http://127.0.0.1:18645 KOMA_DEPLOYMENT_FILE=deployments/local-fork.json npm run test:launchpad
set -e
cd "$(dirname "$0")/.."
ANVIL=${ARC_ANVIL:-arc-anvil}
RPC=http://127.0.0.1:18645
command -v "$ANVIL" >/dev/null || [ -x "$ANVIL" ] || { echo "arc-anvil not found: set ARC_ANVIL (see the header)"; exit 1; }
[ -f .env.local ] || FUND=0 sh scripts/testnet-setup.sh
mkdir -p .data
if ! cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  nohup "$ANVIL" --network arc --fork-url https://rpc.testnet.arc.io --port 18645 --block-time 1 --silent > .data/arc-fork.log 2>&1 &
  echo $! > .data/arc-fork.pid
  i=0; until cast chain-id --rpc-url $RPC >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && exit 1; sleep 1; done
fi
KEYFILE=.data/fork-deployer.env
# anvil's public dev account 0 (from the well-known "test … junk" mnemonic): only ever used on this local fork
printf 'DEPLOYER_PRIVATE_KEY=%s\n' "$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk")" > $KEYFILE
# The fork has testnet's chain id, so forge would file its records with the real testnet deploy's: set those aside.
B=contracts/broadcast/DeployLaunchpad.s.sol/5042002
rm -rf .data/broadcast-keep; [ -d $B ] && mkdir -p .data/broadcast-keep && cp -R $B .data/broadcast-keep/
ARC_TESTNET_RPC_URL=$RPC DEPLOYER_ENV=$KEYFILE ADDRESSES_OUT=deployments/local-fork.json sh scripts/deploy.sh testnet
rm -rf $B; [ -d .data/broadcast-keep/5042002 ] && cp -R .data/broadcast-keep/5042002 $B; rm -rf .data/broadcast-keep
node --input-type=module -e '
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter((l)=>l.includes("=")&&!l.startsWith("#")).map((l)=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1)]));
for (const [k, usdc] of [["SERVER_ADDRESS",3],["TEST_BROWSER_ADDRESS",9],["TEST_AGENT_ADDRESS",7],["TEST_PAYTO_ADDRESS",4.5]]) {
  if (!env[k]) continue;
  const wei = BigInt(Math.round(usdc * 1e6)) * 10n ** 12n; // native USDC has 18 decimals
  await fetch("'$RPC'", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [env[k], "0x" + wei.toString(16)] }) });
  console.log(`${k} ${env[k]}: ${usdc} USDC`);
}'
