import { createPublicClient, encodeFunctionData, http, toFunctionSelector, toHex, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from "viem";
import { KOMA, RPC_URL, USDC_DOMAIN, CCTP } from "@/lib/network";
import { coinAbi, curveAbi, erc20ApproveAbi, erc20TransferAbi, tokenMessengerAbi, graduatorAbi, permitTypes, quoterAbi, receiveAuthTypes, sellTypes, swapperAbi, tokenboundAbi, usdcAbi, voteTypes } from "./abi";
import { buyNonce } from "./intents";

// Browser-side launchpad helpers: reads through KOMA's RPC, and the typed-data
// signatures behind gasless trades and canon votes. Wallets pay nothing to
// sign; KOMA's relayer submits the result and pays the gas.

/** Reads for the browser (the /api/rpc proxy on the hosted build). */
export const lpClient = createPublicClient({ chain: KOMA.chain, transport: http(RPC_URL) });

/** Any viem wallet client with an account, e.g. useWallet().walletClient(). */
export type Signer = WalletClient<Transport, Chain | undefined, Account>;

const chainId = KOMA.chain.id;
/** How long a signed trade stays valid. */
const TTL = 10 * 60;

const deadlineFromNow = () => BigInt(Math.floor(Date.now() / 1000) + TTL);
const randomSalt = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

export type BuyRelay = {
  kind: "buy"; curve: Address; buyer: Address; usdcIn: string; minCoinOut: string; deadline: string;
  salt: Hex; validAfter: string; validBefore: string; signature: Hex;
};
export type SellRelay = {
  kind: "sell"; curve: Address; seller: Address; coinIn: string; minUsdcOut: string; deadline: string; permit: Hex; intentSignature: Hex;
};

/**
 * One USDC signature (EIP-3009 ReceiveWithAuthorization) whose nonce commits
 * to the curve, amount, minimum out and deadline. Only the curve can redeem it.
 */
export async function signGaslessBuy(
  wallet: Signer,
  o: { curve: Address; buyer: Address; usdcIn: bigint; minCoinOut: bigint },
): Promise<BuyRelay> {
  const deadline = deadlineFromNow();
  const salt = randomSalt();
  const nonce = buyNonce({ ...o, deadline, salt });
  const validAfter = BigInt(0);
  const signature = await wallet.signTypedData({
    account: wallet.account,
    domain: { ...USDC_DOMAIN, chainId, verifyingContract: KOMA.usdc },
    types: receiveAuthTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: o.buyer, to: o.curve, value: o.usdcIn, validAfter, validBefore: deadline, nonce },
  });
  return {
    kind: "buy",
    curve: o.curve,
    buyer: o.buyer,
    usdcIn: o.usdcIn.toString(),
    minCoinOut: o.minCoinOut.toString(),
    deadline: deadline.toString(),
    salt,
    validAfter: "0",
    validBefore: deadline.toString(),
    signature,
  };
}

/**
 * Two signatures: an ERC-2612 permit letting the curve take the coins, and a
 * Sell intent binding the minimum USDC out, deadline and the seller's nonce.
 */
export async function signGaslessSell(
  wallet: Signer,
  o: { curve: Address; coin: Address; seller: Address; coinIn: bigint; minUsdcOut: bigint },
): Promise<SellRelay> {
  const deadline = deadlineFromNow();
  const [permitNonce, name, sellNonce] = await Promise.all([
    lpClient.readContract({ address: o.coin, abi: coinAbi, functionName: "nonces", args: [o.seller] }),
    lpClient.readContract({ address: o.coin, abi: coinAbi, functionName: "name" }),
    lpClient.readContract({ address: o.curve, abi: curveAbi, functionName: "sellNonces", args: [o.seller] }),
  ]);
  const permit = await wallet.signTypedData({
    account: wallet.account,
    domain: { name, version: "1", chainId, verifyingContract: o.coin },
    types: permitTypes,
    primaryType: "Permit",
    message: { owner: o.seller, spender: o.curve, value: o.coinIn, nonce: permitNonce, deadline },
  });
  const intentSignature = await wallet.signTypedData({
    account: wallet.account,
    domain: { name: "KOMA Curve", version: "1", chainId, verifyingContract: o.curve },
    types: sellTypes,
    primaryType: "Sell",
    message: { seller: o.seller, coinIn: o.coinIn, minUsdcOut: o.minUsdcOut, deadline, nonce: sellNonce },
  });
  return {
    kind: "sell",
    curve: o.curve,
    seller: o.seller,
    coinIn: o.coinIn.toString(),
    minUsdcOut: o.minUsdcOut.toString(),
    deadline: deadline.toString(),
    permit,
    intentSignature,
  };
}

/** A free canon vote. Its weight is the voter's balance when the episode opened. */
export async function signVote(
  wallet: Signer,
  o: { canonRegistry: Address; seriesId: number; episode: number; issueId: number; voter: Address },
): Promise<Hex> {
  return wallet.signTypedData({
    account: wallet.account,
    domain: { name: "KOMA Canon", version: "1", chainId, verifyingContract: o.canonRegistry },
    types: voteTypes,
    primaryType: "Vote",
    message: { seriesId: BigInt(o.seriesId), episode: BigInt(o.episode), issueId: BigInt(o.issueId), voter: o.voter },
  });
}

// ——— After graduation: trading in the series' Uniswap v4 pool via KomaSwapper.

export type SwapBuyRelay = {
  kind: "swap-buy"; seriesId: number; buyer: Address; usdcIn: string; minCoinOut: string; deadline: string;
  salt: Hex; validAfter: string; validBefore: string; signature: Hex;
};

/** Exact-input quote from the v4 Quoter. `buyCoin`: USDC in, coins out. */
export async function quotePool(o: { quoter: Address; graduator: Address; seriesId: number; buyCoin: boolean; amountIn: bigint }) {
  const key = await lpClient.readContract({ address: o.graduator, abi: graduatorAbi, functionName: "poolKeyOf", args: [BigInt(o.seriesId)] });
  // USDC → coin is zeroForOne exactly when USDC is currency0.
  const usdcIs0 = key.currency0.toLowerCase() === KOMA.usdc.toLowerCase();
  const { result } = await lpClient.simulateContract({
    address: o.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne: o.buyCoin === usdcIs0, exactAmount: o.amountIn, hookData: "0x" }],
  });
  return result[0];
}

/** One USDC signature, redeemable only by KomaSwapper for this series, amount, minimum and deadline. */
export async function signGaslessSwapBuy(
  wallet: Signer,
  o: { swapper: Address; seriesId: number; buyer: Address; usdcIn: bigint; minCoinOut: bigint },
): Promise<SwapBuyRelay> {
  const deadline = deadlineFromNow();
  const salt = randomSalt();
  const nonce = await lpClient.readContract({
    address: o.swapper,
    abi: swapperAbi,
    functionName: "swapNonce",
    args: [o.buyer, BigInt(o.seriesId), o.usdcIn, o.minCoinOut, deadline, salt],
  });
  const signature = await wallet.signTypedData({
    account: wallet.account,
    domain: { ...USDC_DOMAIN, chainId, verifyingContract: KOMA.usdc },
    types: receiveAuthTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: o.buyer, to: o.swapper, value: o.usdcIn, validAfter: BigInt(0), validBefore: deadline, nonce },
  });
  return {
    kind: "swap-buy",
    seriesId: o.seriesId,
    buyer: o.buyer,
    usdcIn: o.usdcIn.toString(),
    minCoinOut: o.minCoinOut.toString(),
    deadline: deadline.toString(),
    salt,
    validAfter: "0",
    validBefore: deadline.toString(),
    signature,
  };
}

/** Wallet-sent swap through the pool (gas is paid in USDC, like everything else on Arc); the only way to sell after graduation. */
export async function directSwap(wallet: Signer, o: { swapper: Address; seriesId: number; coin: Address; buyCoin: boolean; amountIn: bigint; minOut: bigint }): Promise<Hex> {
  if (o.buyCoin) await ensureAllowance(wallet, KOMA.usdc, usdcAbi, o.swapper, o.amountIn);
  else await ensureAllowance(wallet, o.coin, coinAbi, o.swapper, o.amountIn);
  return wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.swapper,
    abi: swapperAbi,
    functionName: "swapExactIn",
    args: [BigInt(o.seriesId), o.buyCoin, o.amountIn, o.minOut, wallet.account.address],
  });
}

/** Sends a signed intent to KOMA's relayer; resolves to the transaction hash. */
export async function relay(body: BuyRelay | SellRelay | SwapBuyRelay): Promise<Hex> {
  const res = await fetch("/api/trade/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => null)) as { txHash?: Hex; error?: string } | null;
  if (!res.ok || !out?.txHash) throw new Error(tradeError(out?.error ?? `The relayer answered ${res.status}.`));
  return out.txHash;
}

// The curve's custom errors. The shared ABI doesn't declare them, so a revert
// can reach us as a bare selector; match the name or the selector.
const ERRORS: [string, string][] = [
  ["SnipeCap(uint256,uint256)", "During a series' first 10 minutes one wallet can hold at most 20,000,000 coins. Try a smaller buy."],
  ["Slippage(uint256,uint256)", "The price moved more than 1% before your trade landed. Nothing was spent; try again."],
  ["Expired(uint256)", "The signature expired before it was sent. Nothing was spent; try again."],
  ["CurveComplete()", "The curve just reached its target, so trading on it has stopped."],
  ["InsufficientReserve(uint256,uint256)", "The curve doesn't hold enough USDC for that sale. Try a smaller amount."],
  ["InvalidIntentSignature()", "The sell signature didn't check out. Try again."],
  ["ZeroAmount()", "Enter an amount above zero."],
  ["NotGraduated(uint256)", "This series still trades on its curve."],
  ["InsufficientAllowance(uint256,uint256)", "The curve isn't allowed to take those coins yet. Try again."],
];
const KNOWN = ERRORS.map(([sig, words]) => ({ name: sig.slice(0, sig.indexOf("(")), selector: toFunctionSelector(sig), words }));

/** Contract errors → words. */
export function tradeError(raw: string) {
  const hit = KNOWN.find((k) => raw.includes(k.name) || raw.toLowerCase().includes(k.selector));
  if (hit) return hit.words;
  if (/reject|denied/i.test(raw)) return "Request cancelled in your wallet.";
  if (/transfer amount exceeds balance|exceeds balance/i.test(raw)) return "Your wallet doesn't have enough for that.";
  if (/graduated/i.test(raw)) return raw;
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

// ——— "Send it yourself": the wallet submits and pays the gas.

async function ensureAllowance(wallet: Signer, token: Address, abi: typeof usdcAbi | typeof coinAbi, spender: Address, amount: bigint) {
  const owner = wallet.account.address;
  const allowance = await lpClient.readContract({ address: token, abi, functionName: "allowance", args: [owner, spender] });
  if (allowance >= amount) return;
  const hash = await wallet.writeContract({ account: wallet.account, chain: KOMA.chain, address: token, abi, functionName: "approve", args: [spender, amount] });
  const r = await lpClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("The approval transaction reverted.");
}

export async function directBuy(wallet: Signer, o: { curve: Address; usdcIn: bigint; minCoinOut: bigint }): Promise<Hex> {
  await ensureAllowance(wallet, KOMA.usdc, usdcAbi, o.curve, o.usdcIn);
  return wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.curve,
    abi: curveAbi,
    functionName: "buy",
    args: [o.usdcIn, o.minCoinOut, wallet.account.address],
  });
}

export async function directSell(wallet: Signer, o: { curve: Address; coin: Address; coinIn: bigint; minUsdcOut: bigint }): Promise<Hex> {
  await ensureAllowance(wallet, o.coin, coinAbi, o.curve, o.coinIn);
  return wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.curve,
    abi: curveAbi,
    functionName: "sell",
    args: [o.coinIn, o.minUsdcOut, wallet.account.address],
  });
}

/** Waits for a trade to land; throws if it reverted. */
export async function landed(hash: Hex) {
  const r = await lpClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error("The transaction reverted on-chain.");
  return r;
}

// ——— The character's wallet (ERC-6551, Tokenbound AccountV3).

/**
 * Moves USDC out of a character's wallet to the Character NFT's owner. The
 * owner's wallet calls execute() on the account, which makes the account call
 * USDC.transfer. A normal wallet transaction: the owner pays the gas.
 */
export async function withdrawCharacterUsdc(wallet: Signer, o: { account: Address; amount: bigint }): Promise<Hex> {
  const data = encodeFunctionData({ abi: erc20TransferAbi, functionName: "transfer", args: [wallet.account.address, o.amount] });
  return wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.account,
    abi: tokenboundAbi,
    functionName: "execute",
    args: [KOMA.usdc, BigInt(0), data, 0],
  });
}

// ——— Cross-chain withdrawal (Circle CCTP V2 + Forwarding Service).

/** CCTP's Forwarding Service hook: magic "cctp-forward", version 0, no extra data. Circle mints on the destination. */
export const FORWARD_HOOK: Hex = "0x636374702d666f72776172640000000000000000000000000000000000000000";
/** Standard finality: Arc blocks are final on inclusion, so a standard attestation is already quick and fee-free. */
const STANDARD_FINALITY = 2000;

export type CctpQuote = { forwardFee: bigint; protocolFeeBps: number; maxFee: bigint };

/** Fee for burning on Arc and having Circle mint on `destDomain` (the Forwarding Service's gas, plus CCTP's rate). */
export async function cctpQuote(destDomain: number, amount: bigint): Promise<CctpQuote> {
  const res = await fetch(`${KOMA.cctp.iris}/v2/burn/USDC/fees/${CCTP.arcDomain}/${destDomain}?forward=true`);
  if (!res.ok) throw new Error(`Circle's fee API answered ${res.status}.`);
  const rows = (await res.json()) as { finalityThreshold: number; minimumFee: number; forwardFee?: { med: number } }[];
  const row = rows.find((r) => r.finalityThreshold === STANDARD_FINALITY) ?? rows[0];
  if (!row?.forwardFee) throw new Error("Circle doesn't forward to that chain right now.");
  const forwardFee = BigInt(row.forwardFee.med);
  const protocolFee = (amount * BigInt(Math.round(row.minimumFee * 100))) / BigInt(1_000_000);
  // A little headroom over the median: forward fees move with destination gas prices between quote and burn.
  const maxFee = ((forwardFee + protocolFee) * BigInt(110)) / BigInt(100);
  return { forwardFee, protocolFeeBps: row.minimumFee, maxFee };
}

/**
 * Sends a character's USDC to another chain. One transaction from the Character NFT's owner: the ERC-6551
 * account runs a batch that approves TokenMessengerV2 and burns with the forwarding hook. Circle attests the burn
 * and its Forwarding Service mints `amount - fees` to `recipient` on the destination, so the owner never needs
 * gas there.
 */
export async function bridgeCharacterUsdc(
  wallet: Signer,
  o: { account: Address; amount: bigint; destDomain: number; recipient: Address; maxFee: bigint },
): Promise<Hex> {
  if (o.amount <= o.maxFee) throw new Error("That's less than Circle's forwarding fee.");
  const messenger = KOMA.cctp.tokenMessenger as Address;
  const mintRecipient = `0x${o.recipient.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  const zero32 = `0x${"0".repeat(64)}` as Hex;
  const approve = encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [messenger, o.amount] });
  const burn = encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: "depositForBurnWithHook",
    args: [o.amount, o.destDomain, mintRecipient, KOMA.usdc, zero32, o.maxFee, STANDARD_FINALITY, FORWARD_HOOK],
  });
  return wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.account,
    abi: tokenboundAbi,
    functionName: "executeBatch",
    args: [[
      { to: KOMA.usdc, value: BigInt(0), data: approve, operation: 0 },
      { to: messenger, value: BigInt(0), data: burn, operation: 0 },
    ]],
  });
}

export type CctpStatus = { status: string; forwardState?: string; forwardTxHash?: string; delayReason?: string | null };

/** Where a burn is: Circle's attestation status and, with forwarding, the destination mint. */
export async function cctpStatus(burnTx: Hex): Promise<CctpStatus | null> {
  const res = await fetch(`${KOMA.cctp.iris}/v2/messages/${CCTP.arcDomain}?transactionHash=${burnTx}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Circle's attestation API answered ${res.status}.`);
  const body = (await res.json()) as { messages?: CctpStatus[] };
  return body.messages?.[0] ?? null;
}
