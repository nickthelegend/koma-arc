import { KOMA } from "@/lib/network";

/** Monad: real AUSD, no faucet, no demo series. Everything testnet-only hides behind this. */
export const MAINNET = KOMA.key === "monad";

/** Said on every network: what a coin is for. Never a promise of returns. */
export const COIN_NOTE = "Coins give votes on the story, not a share of fees or any return.";

/** The same, with "testnet collectible" in front where that's true. */
export const COIN_DISCLAIMER = MAINNET ? COIN_NOTE : `A testnet collectible on ${KOMA.label}. ${COIN_NOTE}`;
