/** Circle Gateway intent codec, adapted from the Arc portfolio’s Thenar integration. */
import { encodePacked, keccak256, getAddress, isHex, pad, slice, type Address, type Hex } from "viem";

export interface GatewaySource {
  domain: number;
  name: string;
  usdc: Address;
}

export interface GatewayNetwork {
  apiUrl: string;
  wallet: Address;
  minter: Address;
  arcDomain: number;
  arcUsdc: Address;
  sources: GatewaySource[];
}

/** Where a Gateway balance can sit, testnet (developers.circle.com/gateway, supported chains). */
export const GATEWAY_TESTNET_SOURCES: readonly GatewaySource[] = [
  { domain: 6, name: "Base Sepolia", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  { domain: 0, name: "Ethereum Sepolia", usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
  { domain: 3, name: "Arbitrum Sepolia", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
  { domain: 1, name: "Avalanche Fuji", usdc: "0x5425890298aed601595a70AB815c96711a31Bc65" },
  { domain: 2, name: "OP Sepolia", usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" },
  { domain: 7, name: "Polygon Amoy", usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" },
  { domain: 26, name: "Arc Testnet", usdc: "0x3600000000000000000000000000000000000000" },
];

/** And on mainnet. */
export const GATEWAY_MAINNET_SOURCES: readonly GatewaySource[] = [
  { domain: 6, name: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { domain: 0, name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { domain: 3, name: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  { domain: 1, name: "Avalanche", usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
  { domain: 2, name: "OP Mainnet", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { domain: 7, name: "Polygon PoS", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  { domain: 26, name: "Arc", usdc: "0x3600000000000000000000000000000000000000" },
];

/** Gateway on an Arc network ("mainnet", or "testnet" for testnet and the fork). */
export function gatewayFor(network: string): GatewayNetwork {
  const mainnet = network === "mainnet";
  return {
    apiUrl: mainnet ? "https://gateway-api.circle.com" : "https://gateway-api-testnet.circle.com",
    wallet: mainnet ? "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" : "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    minter: mainnet ? "0x2222222d7164433c4C09B0b0D809a9b52C04C205" : "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    arcDomain: 26,
    arcUsdc: "0x3600000000000000000000000000000000000000",
    sources: [...(mainnet ? GATEWAY_MAINNET_SOURCES : GATEWAY_TESTNET_SOURCES)],
  };
}

/** Circle's gas fee per source domain, USDC base units (developers.circle.com/gateway/references/fees). */
const BASE_FEE: Record<number, bigint> = { 0: BigInt(1_000_000), 6: BigInt(10_000), 26: BigInt(3_500), 3: BigInt(10_000), 2: BigInt(10_000), 1: BigInt(20_000), 7: BigInt(10_000) };

/**
 * The most the buyer lets Gateway take for a transfer of `value` from `domain`:
 * the source's gas fee with a quarter of headroom, plus the 0.005% transfer
 * fee rounded up, plus a cent. Circle charges the actual fee, never more.
 */
export function gatewayMaxFee(domain: number, value: bigint): bigint {
  const base = BASE_FEE[domain] ?? BigInt(1_000_000);
  return (base * BigInt(5)) / BigInt(4) + (value * BigInt(5) + BigInt(99_999)) / BigInt(100_000) + BigInt(10_000);
}

export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

export const BURN_INTENT_DOMAIN = { name: "GatewayWallet", version: "1" } as const;

/** The GatewayMinter call the broker makes with Circle's attestation. */
export const GATEWAY_MINTER_ABI = [
  {
    type: "function",
    name: "gatewayMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** GatewayWallet.deposit, for a buyer funding their unified balance on a chain (approve USDC first). */
export const GATEWAY_WALLET_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "availableBalance",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
/** Per transfer ceiling for one funding transfer top-up (matches the funding page limit). */
export const GATEWAY_MAX_VALUE = BigInt(1_000_000_000); // 1,000 USDC
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const b32 = (a: Address): Hex => pad(getAddress(a), { size: 32 }).toLowerCase() as Hex;
const addrOf = (b: Hex): Address => getAddress(slice(b, 12));

export interface BurnIntent {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: Hex;
    destinationContract: Hex;
    sourceToken: Hex;
    destinationToken: Hex;
    sourceDepositor: Hex;
    destinationRecipient: Hex;
    sourceSigner: Hex;
    destinationCaller: Hex;
    value: bigint;
    salt: Hex;
    hookData: Hex;
  };
}

/** An input error, with the parameter it is about. */
export class GatewayInputError extends Error {
  // A plain field, not a parameter property: Node's type stripping (scripts, tests) cannot run those.
  readonly param: string;
  constructor(message: string, param: string) {
    super(message);
    this.param = param;
    this.name = "GatewayInputError";
  }
}

/** The burn intent that moves `value` of `depositor`'s Gateway balance on `sourceDomain` to `recipient` on Arc. Pure. */
export function buildBurnIntent(
  g: GatewayNetwork,
  input: { sourceDomain: number; depositor: Address; recipient: Address; value: bigint; salt: Hex },
): BurnIntent {
  const source = g.sources.find((s) => s.domain === input.sourceDomain);
  if (!source) throw new GatewayInputError(`sourceDomain must be one of ${g.sources.map((s) => s.domain).join(", ")}`, "sourceDomain");
  if (input.value <= BigInt(0) || input.value > GATEWAY_MAX_VALUE) throw new GatewayInputError("amount must be more than 0 and at most 1,000 USDC", "amount");
  return {
    maxBlockHeight: MAX_UINT256,
    maxFee: gatewayMaxFee(input.sourceDomain, input.value),
    spec: {
      version: 1,
      sourceDomain: input.sourceDomain,
      destinationDomain: g.arcDomain,
      // GatewayWallet and GatewayMinter have the same address on every chain of a network.
      sourceContract: b32(g.wallet),
      destinationContract: b32(g.minter),
      sourceToken: b32(source.usdc),
      destinationToken: b32(g.arcUsdc),
      sourceDepositor: b32(input.depositor),
      destinationRecipient: b32(input.recipient),
      sourceSigner: b32(input.depositor),
      destinationCaller: ZERO32,
      value: input.value,
      salt: input.salt,
      hookData: "0x",
    },
  };
}

/** The intent as JSON (uint256 as decimal strings), the shape the Gateway API and wallets take. */
export function burnIntentToJson(i: BurnIntent) {
  return { maxBlockHeight: i.maxBlockHeight.toString(), maxFee: i.maxFee.toString(), spec: { ...i.spec, value: i.spec.value.toString() } };
}

/** The EIP-712 typed data a buyer signs for an intent. */
export function burnIntentTypedData(i: BurnIntent) {
  return { domain: BURN_INTENT_DOMAIN, types: BURN_INTENT_TYPES, primaryType: "BurnIntent" as const, message: i };
}

/** The recipient on Arc an intent mints to. */
export function burnIntentRecipient(i: BurnIntent): Address {
  return addrOf(i.spec.destinationRecipient);
}

/** The depositor (and signer) of an intent. */
export function burnIntentDepositor(i: BurnIntent): Address {
  return addrOf(i.spec.sourceDepositor);
}

/**
 * Read an intent back from JSON, checking every field KOMA relies on: to Arc,
 * through Circle's minter, as Arc's USDC, signer = depositor, no destination
 * caller, no hook, and a fee no higher than KOMA would have asked for.
 */
export function burnIntentFromJson(g: GatewayNetwork, raw: unknown): BurnIntent {
  const bad = (what: string): never => {
    throw new GatewayInputError(`burnIntent: ${what}`, "burnIntent");
  };
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (o.spec ?? {}) as Record<string, unknown>;
  const big = (v: unknown, name: string): bigint => {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "bigint") return bad(`${name} must be a decimal string`);
    if (typeof v === "number" && !Number.isSafeInteger(v)) return bad(`${name} must be a safe integer`);
    if (typeof v === "string" && !/^\d+$/.test(v)) return bad(`${name} must be a decimal integer`);
    try {
      return BigInt(v);
    } catch {
      return bad(`${name} must be a decimal string`);
    }
  };
  const h32 = (v: unknown, name: string): Hex =>
    typeof v === "string" && isHex(v) && v.length === 66 ? (v.toLowerCase() as Hex) : bad(`${name} must be bytes32`);
  const intent: BurnIntent = {
    maxBlockHeight: big(o.maxBlockHeight, "maxBlockHeight"),
    maxFee: big(o.maxFee, "maxFee"),
    spec: {
      version: Number(s.version),
      sourceDomain: Number(s.sourceDomain),
      destinationDomain: Number(s.destinationDomain),
      sourceContract: h32(s.sourceContract, "sourceContract"),
      destinationContract: h32(s.destinationContract, "destinationContract"),
      sourceToken: h32(s.sourceToken, "sourceToken"),
      destinationToken: h32(s.destinationToken, "destinationToken"),
      sourceDepositor: h32(s.sourceDepositor, "sourceDepositor"),
      destinationRecipient: h32(s.destinationRecipient, "destinationRecipient"),
      sourceSigner: h32(s.sourceSigner, "sourceSigner"),
      destinationCaller: h32(s.destinationCaller, "destinationCaller"),
      value: big(s.value, "value"),
      salt: h32(s.salt, "salt"),
      hookData: typeof s.hookData === "string" && isHex(s.hookData) ? (s.hookData as Hex) : bad("hookData must be hex bytes"),
    },
  };
  const expected = buildBurnIntent(g, {
    sourceDomain: intent.spec.sourceDomain,
    depositor: addrOf(intent.spec.sourceDepositor),
    recipient: addrOf(intent.spec.destinationRecipient),
    value: intent.spec.value,
    salt: intent.spec.salt,
  });
  for (const k of ["version", "destinationDomain", "sourceContract", "destinationContract", "sourceToken", "destinationToken", "sourceDepositor", "destinationRecipient", "sourceSigner", "destinationCaller", "hookData"] as const) {
    if (String(intent.spec[k]).toLowerCase() !== String(expected.spec[k]).toLowerCase()) {
      bad(`${k} isn't KOMA's (Arc, Circle's GatewayMinter, USDC, signer = depositor, no destination caller)`);
    }
  }
  if (intent.maxFee < BigInt(0) || intent.maxFee > BigInt(10_000_000)) bad("maxFee must be between 0 and 10 USDC");
  if (intent.maxBlockHeight <= BigInt(0) || intent.maxBlockHeight > MAX_UINT256) bad("invalid maxBlockHeight");
  return intent;
}

/** Circle packed TransferSpec identifier; source: circlefin/evm-gateway-contracts/src/lib/TransferSpec.sol. */
export function gatewayTransferSpecHash(i: BurnIntent): Hex {
  const s = i.spec;
  return keccak256(encodePacked(
    ['bytes4', 'uint32', 'uint32', 'uint32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'uint32', 'bytes'],
    ['0xca85def7', s.version, s.sourceDomain, s.destinationDomain, s.sourceContract, s.destinationContract, s.sourceToken, s.destinationToken, s.sourceDepositor, s.destinationRecipient, s.sourceSigner, s.destinationCaller, s.value, s.salt, (s.hookData.length - 2) / 2, s.hookData],
  ));
}
