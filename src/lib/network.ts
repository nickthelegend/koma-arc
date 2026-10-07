import { defineChain } from "viem";

// Shared by the browser and the server. NEXT_PUBLIC_ values are inlined at build.
const RPC_OVERRIDE = process.env.NEXT_PUBLIC_ARC_RPC_URL;

/**
 * Arc: Circle's stablecoin-native L1. USDC is the gas token: the native balance (18 decimals) and the ERC-20 at
 * 0x3600…0000 (6 decimals) are one balance, so a KOMA user only ever holds USDC. Blocks finalize deterministically
 * in under a second, so a payment is final when its receipt arrives.
 */
const nativeCurrency = { name: "USDC", symbol: "USDC", decimals: 18 } as const;
const multicall3 = { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 0 } as const;

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency,
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  contracts: { multicall3 },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency,
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
  contracts: { multicall3 },
});

/** The USDC ERC-20 interface: same address on Arc mainnet and testnet. */
const USDC = "0x3600000000000000000000000000000000000000" as const;

/**
 * CCTP V2 on Arc (domain 26). Character wallets use it to send their USDC earnings to another chain; Circle's
 * Forwarding Service mints on the destination, so the holder only signs on Arc.
 */
export const CCTP = {
  arcDomain: 26,
  testnet: { tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA", iris: "https://iris-api-sandbox.circle.com" },
  mainnet: { tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", iris: "https://iris-api.circle.com" },
} as const;

export type CctpDestination = { domain: number; name: string; explorer: string };
/** Destinations offered for a character's cross-chain withdrawal (EVM chains the Forwarding Service mints on). */
export const CCTP_DESTINATIONS: { testnet: CctpDestination[]; mainnet: CctpDestination[] } = {
  testnet: [
    { domain: 6, name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
    { domain: 0, name: "Ethereum Sepolia", explorer: "https://sepolia.etherscan.io" },
    { domain: 3, name: "Arbitrum Sepolia", explorer: "https://sepolia.arbiscan.io" },
    { domain: 2, name: "OP Sepolia", explorer: "https://sepolia-optimism.etherscan.io" },
    { domain: 1, name: "Avalanche Fuji", explorer: "https://testnet.snowtrace.io" },
  ],
  mainnet: [
    { domain: 6, name: "Base", explorer: "https://basescan.org" },
    { domain: 0, name: "Ethereum", explorer: "https://etherscan.io" },
    { domain: 3, name: "Arbitrum", explorer: "https://arbiscan.io" },
    { domain: 2, name: "OP Mainnet", explorer: "https://optimistic.etherscan.io" },
    { domain: 1, name: "Avalanche", explorer: "https://snowtrace.io" },
  ],
};

export const NETWORKS = {
  arc: {
    key: "arc",
    chain: arcMainnet,
    caip: "eip155:5042",
    usdc: USDC,
    explorer: "https://explorer.arc.io",
    label: "Arc",
    testnet: false,
    faucetUrl: null,
    cctp: CCTP.mainnet,
    cctpDestinations: CCTP_DESTINATIONS.mainnet,
  },
  "arc-testnet": {
    key: "arc-testnet",
    chain: arcTestnet,
    caip: "eip155:5042002",
    usdc: USDC,
    explorer: "https://explorer.testnet.arc.io",
    label: "Arc testnet",
    testnet: true,
    /** Circle's faucet hands out testnet USDC on Arc (it is also the gas token). */
    faucetUrl: "https://faucet.circle.com",
    cctp: CCTP.testnet,
    cctpDestinations: CCTP_DESTINATIONS.testnet,
  },
} as const;

export type NetworkKey = keyof typeof NETWORKS;

const selected = process.env.NEXT_PUBLIC_KOMA_NETWORK as NetworkKey | undefined;
export const KOMA = NETWORKS[selected && selected in NETWORKS ? selected : "arc-testnet"];

export const RPC_URL = RPC_OVERRIDE || KOMA.chain.rpcUrls.default.http[0];

/** The payment token's symbol, for copy. */
export const TOKEN = "USDC";

/** EIP-712 domain of USDC on Arc (name() "USDC", version() "2"), used for permit and EIP-3009 signatures. */
export const USDC_DOMAIN = { name: "USDC", version: "2" } as const;

// ——— Pricing (USDC). Comics keep the 10¢ hook; everything that costs KOMA more pays its way.
/** A comic page. The loss leader: about break-even on one page, profitable from two. */
export const PRICE_PER_PAGE = 0.1;
/** A series episode page: drawn with the character sheet as a reference, which costs fal twice as much per panel. */
export const EPISODE_PRICE_PER_PAGE = 0.3;
/** Launching a series (character sheet + the launch transaction KOMA sends). */
export const LAUNCH_PRICE = 1;
/** Curve trading fee and how it's split on chain (LaunchpadConstants / royalty router). */
export const TRADE_FEE_PCT = 1.5;
export const FEE_SPLIT = { character: 40, remix: 20, treasury: 40 } as const;
/** Share of the USDC raised that goes to KOMA's treasury when a curve graduates. */
export const GRADUATION_FEE_PCT = 5;
/**
 * Smallest trade KOMA's relayer submits for free. A relayed buy costs about 0.005 USDC of gas on Arc (≈250k gas at
 * the 20 gwei floor); a $1 trade's fee is 0.015 USDC, so the relayer stays ahead from $1.
 */
export const GASLESS_MIN_USDC = 1;
export const PAGE_OPTIONS = [1, 2, 4, 6] as const;
export const USDC_DECIMALS = 6;
