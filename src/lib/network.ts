import { defineChain } from "viem";
import { monad, monadTestnet } from "viem/chains";

// Shared by the browser and the server. NEXT_PUBLIC_ values are inlined at build.
const RPC_OVERRIDE = process.env.NEXT_PUBLIC_MONAD_RPC_URL;
const LOCAL_ID = Number(process.env.NEXT_PUBLIC_KOMA_CHAIN_ID || 10143);

/**
 * A local fork of Monad testnet (anvil), so AUSD is the real Agora contract. It keeps chain id
 * 10143 by default so signatures made against it match the token's EIP-712 domain.
 */
const komaLocalnet = defineChain({
  id: LOCAL_ID,
  name: "KOMA Localnet (Monad testnet fork)",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_OVERRIDE || "http://127.0.0.1:18643"] } },
  testnet: true,
});

/** Agora's AUSD. Internally KOMA still calls its stablecoin `usdc`; on Monad that is always AUSD. */
const AUSD = {
  testnet: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  mainnet: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  /** Agora's testnet faucet: requestFunds(address) → 10,000 AUSD. */
  testnetFaucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
} as const;

export const NETWORKS = {
  monad: {
    key: "monad",
    chain: monad,
    caip: "eip155:143",
    usdc: AUSD.mainnet,
    ausdFaucet: null,
    explorer: "https://monadvision.com",
    label: "Monad",
    faucet: false,
  },
  "monad-testnet": {
    key: "monad-testnet",
    chain: monadTestnet,
    caip: "eip155:10143",
    usdc: AUSD.testnet,
    ausdFaucet: AUSD.testnetFaucet,
    explorer: "https://testnet.monadvision.com",
    label: "Monad testnet",
    faucet: true,
  },
  "koma-localnet": {
    key: "koma-localnet",
    chain: komaLocalnet,
    caip: `eip155:${LOCAL_ID}` as `eip155:${number}`,
    usdc: AUSD.testnet,
    ausdFaucet: AUSD.testnetFaucet,
    explorer: "",
    label: "KOMA Localnet",
    faucet: true,
  },
} as const;

export type NetworkKey = keyof typeof NETWORKS;

const selected = process.env.NEXT_PUBLIC_KOMA_NETWORK as NetworkKey | undefined;
export const KOMA = NETWORKS[selected && selected in NETWORKS ? selected : "monad-testnet"];

export const RPC_URL = RPC_OVERRIDE || KOMA.chain.rpcUrls.default.http[0];

/** The payment token's symbol, for copy. */
export const TOKEN = "AUSD";

/** EIP-712 domain of AUSD (read on-chain: eip712Domain() → "Agora Dollar", "1"), used for permit and EIP-3009 signatures. */
export const USDC_DOMAIN = { name: "Agora Dollar", version: "1" } as const;

// ——— Pricing (AUSD). Comics keep the 10¢ hook; everything that costs KOMA more pays its way.
/** A comic page. The loss leader: about break-even on one page, profitable from two. */
export const PRICE_PER_PAGE = 0.1;
/** A series episode page: drawn with the character sheet as a reference, which costs fal twice as much per panel. */
export const EPISODE_PRICE_PER_PAGE = 0.3;
/** Launching a series (character sheet + a ~5M-gas launch transaction). */
export const LAUNCH_PRICE = 1;
/** Curve trading fee and how it's split on chain (LaunchpadConstants / royalty router). */
export const TRADE_FEE_PCT = 1.5;
export const FEE_SPLIT = { character: 40, remix: 20, treasury: 40 } as const;
/** Share of the AUSD raised that goes to KOMA's treasury when a curve graduates. */
export const GRADUATION_FEE_PCT = 5;
/** Smallest trade KOMA's relayer submits for free; below it the trade costs more gas than its fee. */
export const GASLESS_MIN_USDC = 3;
export const PAGE_OPTIONS = [1, 2, 4, 6] as const;
export const USDC_DECIMALS = 6;
