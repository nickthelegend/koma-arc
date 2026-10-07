#!/bin/sh
# Verify KOMA's contracts on the Arc explorer (Blockscout), from the addresses the deploy script wrote.
#   sh scripts/verify.sh testnet|mainnet
# Uniswap v4 (deployed from Uniswap's own artifacts) and the canonical Tokenbound contracts are skipped: their
# sources aren't in this repo (they match the verified code on other chains byte for byte).
set -e
cd "$(dirname "$0")/.."
NETWORK=${1:-${NETWORK:-testnet}}
case "$NETWORK" in
  testnet) RPC=https://rpc.testnet.arc.io; FILE=deployments/arc-testnet.json; API=https://explorer.testnet.arc.io/api/ ;;
  mainnet) RPC=https://rpc.mainnet.arc.io; FILE=deployments/arc-mainnet.json; API=https://explorer.arc.io/api/ ;;
  *) echo "usage: sh scripts/verify.sh testnet|mainnet"; exit 1 ;;
esac
get() { node -e "console.log(require('./$FILE').$1)"; }
cd contracts
v() {
  echo "verifying $2 at $1"
  forge verify-contract "$1" "$2" --verifier blockscout --verifier-url "$API" --rpc-url "$RPC" --guess-constructor-args --watch || echo "  (failed: $2)"
}
v "$(get komaIssues)" src/KomaIssues.sol:KomaIssues
v "$(get seriesFactory)" src/SeriesFactory.sol:SeriesFactory
v "$(get characterNft)" src/CharacterNFT.sol:CharacterNFT
v "$(get canonRegistry)" src/CanonRegistry.sol:CanonRegistry
v "$(get graduator)" src/Graduator.sol:Graduator
v "$(get swapper)" src/KomaSwapper.sol:KomaSwapper
v "$(get curveMath)" src/CurveMathReference.sol:CurveMathReference
v "$(get royaltyRouter)" src/RoyaltyRouterReference.sol:RoyaltyRouterReference
