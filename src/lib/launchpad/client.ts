import { cctpFeeQuote, type CctpFeeRow } from "./cctp-fees";
import type {PendingTrade} from "./pending-trade";
import {UnconfirmedTradeError} from "./trade-guard";
import { createPublicClient, parseEventLogs, parseAbiItem, erc20Abi, decodeFunctionData, encodeFunctionData, http, toFunctionSelector, toHex, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from "viem";
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

/** Re-read the provider before each separate signature or broadcast. */
async function requireSignerContext(wallet: Signer) {
  const [addresses, chainId] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
  if (chainId !== KOMA.chain.id || !addresses.some(address => address.toLowerCase() === wallet.account.address.toLowerCase())) {
    throw new Error("The wallet or network changed. No further transaction was requested.");
  }
}


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
  await requireSignerContext(wallet);
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
  await requireSignerContext(wallet);
  const permit = await wallet.signTypedData({
    account: wallet.account,
    domain: { name, version: "1", chainId, verifyingContract: o.coin },
    types: permitTypes,
    primaryType: "Permit",
    message: { owner: o.seller, spender: o.curve, value: o.coinIn, nonce: permitNonce, deadline },
  });
  await requireSignerContext(wallet);
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
  await requireSignerContext(wallet);
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
export async function directSwap(wallet: Signer, o: { swapper: Address; seriesId: number; coin: Address; buyCoin: boolean; amountIn: bigint; minOut: bigint }, observe?:TradeObserver): Promise<Hex> {
  if (o.buyCoin) await ensureAllowance(wallet, KOMA.usdc, usdcAbi, o.swapper, o.amountIn, observe);
  else await ensureAllowance(wallet, o.coin, coinAbi, o.swapper, o.amountIn, observe);
  await requireSignerContext(wallet);
  observe?.("trade",o.swapper);
  const hash=await wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.swapper,
    abi: swapperAbi,
    functionName: "swapExactIn",
    args: [BigInt(o.seriesId), o.buyCoin, o.amountIn, o.minOut, wallet.account.address],
  });
  observe?.("trade",o.swapper,hash);
  return hash;
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

async function ensureAllowance(wallet: Signer, token: Address, abi: typeof usdcAbi | typeof coinAbi, spender: Address, amount: bigint, observe?:TradeObserver) {
  const owner = wallet.account.address;
  const allowance = await lpClient.readContract({ address: token, abi, functionName: "allowance", args: [owner, spender] });
  if (allowance >= amount) return;
  await requireSignerContext(wallet);
  observe?.("approval",token);
  const hash = await wallet.writeContract({ account: wallet.account, chain: KOMA.chain, address: token, abi, functionName: "approve", args: [spender, amount] });
  observe?.("approval",token,hash);
  const r = await lpClient.waitForTransactionReceipt({ hash }).catch(()=>{throw new UnconfirmedTradeError(hash);});
  if(r.transactionHash.toLowerCase()!==hash.toLowerCase())throw new UnconfirmedTradeError(hash);
  if (r.status !== "success") throw new Error("The approval transaction reverted.");
  const [tx, code] = await Promise.all([lpClient.getTransaction({hash}), lpClient.getCode({address:token,blockNumber:r.blockNumber})]);
  if (tx.hash.toLowerCase() !== hash.toLowerCase() || tx.from.toLowerCase() !== owner.toLowerCase() || r.from.toLowerCase() !== owner.toLowerCase()
    || tx.to?.toLowerCase() !== token.toLowerCase() || r.to?.toLowerCase() !== token.toLowerCase() || tx.blockHash !== r.blockHash
    || tx.input.toLowerCase() !== encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[spender,amount]}).toLowerCase() || !code || code === "0x") throw new UnconfirmedTradeError(hash);

  const approved=parseEventLogs({abi:erc20Abi,eventName:"Approval",logs:r.logs}).some(log=>!log.removed&&log.address.toLowerCase()===token.toLowerCase()&&log.args.owner.toLowerCase()===owner.toLowerCase()&&log.args.spender.toLowerCase()===spender.toLowerCase()&&log.args.value===amount);
  if(!approved)throw new UnconfirmedTradeError(hash);
  if(await lpClient.getChainId()!==KOMA.chain.id)throw new UnconfirmedTradeError(hash);
  const canonical=await lpClient.getBlock({blockNumber:r.blockNumber});const final=await lpClient.getBlock({blockTag:"finalized"});
  if(canonical.hash!==r.blockHash||final.number===null||final.number<r.blockNumber)throw new UnconfirmedTradeError(hash);
}

export async function directBuy(wallet: Signer, o: { curve: Address; usdcIn: bigint; minCoinOut: bigint }, observe?:TradeObserver): Promise<Hex> {
  await ensureAllowance(wallet, KOMA.usdc, usdcAbi, o.curve, o.usdcIn, observe);
  await requireSignerContext(wallet);
  observe?.("trade",o.curve);
  const hash=await wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.curve,
    abi: curveAbi,
    functionName: "buy",
    args: [o.usdcIn, o.minCoinOut, wallet.account.address],
  });
  observe?.("trade",o.curve,hash);
  return hash;
}

export async function directSell(wallet: Signer, o: { curve: Address; coin: Address; coinIn: bigint; minUsdcOut: bigint }, observe?:TradeObserver): Promise<Hex> {
  await ensureAllowance(wallet, o.coin, coinAbi, o.curve, o.coinIn, observe);
  await requireSignerContext(wallet);
  observe?.("trade",o.curve);
  const hash=await wallet.writeContract({
    account: wallet.account,
    chain: KOMA.chain,
    address: o.curve,
    abi: curveAbi,
    functionName: "sell",
    args: [o.coinIn, o.minUsdcOut, wallet.account.address],
  });
  observe?.("trade",o.curve,hash);
  return hash;
}

/** Waits for a trade to land; throws if it reverted. */
export async function landed(hash: Hex) {
  const r = await lpClient.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => { throw new UnconfirmedTradeError(hash); });
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
  const rows = (await res.json()) as CctpFeeRow[];
  return cctpFeeQuote(rows, amount, STANDARD_FINALITY);
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


export type TradeObserver=(stage:"approval"|"trade",contract:Address,hash?:Hex)=>void;
export async function recoverPendingTrade(p:PendingTrade):Promise<"approval-confirmed"|"trade-confirmed"|"reverted"> {
 if(!p.hash)throw new Error("No transaction hash was returned. Provider or relayer history is required; no automatic resubmission is safe.");
 if(p.chainId!==5042002 || KOMA.chain.id!==5042002 || await lpClient.getChainId()!==5042002)throw new Error("Recovery RPC is not Arc testnet");
 const [r,tx]=await Promise.all([lpClient.getTransactionReceipt({hash:p.hash}),lpClient.getTransaction({hash:p.hash})]);
 if(r.transactionHash.toLowerCase()!==p.hash.toLowerCase()||tx.hash.toLowerCase()!==p.hash.toLowerCase()||tx.to?.toLowerCase()!==p.stepContract.toLowerCase()||r.to?.toLowerCase()!==p.stepContract.toLowerCase()||r.from.toLowerCase()!==tx.from.toLowerCase()||tx.blockHash!==r.blockHash)throw new Error("Receipt identity does not match the pending transaction");
 const block=await lpClient.getBlock({blockNumber:r.blockNumber});const final=await lpClient.getBlock({blockTag:"finalized"});
 if(block.hash?.toLowerCase()!==r.blockHash.toLowerCase()||final.number===null||final.number<r.blockNumber)throw new Error("Transaction receipt is not finalized");
 const same=(a:unknown,b:string)=>typeof a==="string"&&a.toLowerCase()===b.toLowerCase();
 if(p.stage==="approval"){
  if(!same(p.stepContract,p.side==="buy"?KOMA.usdc:p.coin))throw new Error("Approval token is outside the frozen operation");
  const call=decodeFunctionData({abi:usdcAbi,data:tx.input});const args=call.args as readonly unknown[];
  if(call.functionName!=="approve"||!same(tx.from,p.wallet)||!same(args[0],p.tradeContract)||String(args[1])!==p.amount)throw new Error("Approval does not match its frozen wallet/spender/amount");
 }else if(p.stage==="trade"){
  if(!same(p.stepContract,p.tradeContract))throw new Error("Trade contract is outside the frozen operation");
  const call=decodeFunctionData({abi:p.pool?swapperAbi:curveAbi,data:tx.input});const a=call.args as readonly unknown[];
  const direct=p.direct||(p.pool&&p.side==="sell");
  if(direct&&!same(tx.from,p.wallet))throw new Error("Trade sender does not match its frozen wallet");
  const match=p.pool?(direct?call.functionName==="swapExactIn"&&String(a[0])===String(p.seriesId)&&a[1]===(p.side==="buy")&&String(a[2])===p.amount&&String(a[3])===p.minimum&&same(a[4],p.wallet):call.functionName==="swapWithAuthorization"&&same(a[0],p.wallet)&&String(a[1])===String(p.seriesId)&&String(a[2])===p.amount&&String(a[3])===p.minimum):(direct?call.functionName===p.side&&String(a[0])===p.amount&&String(a[1])===p.minimum&&same(a[2],p.wallet):call.functionName===(p.side==="buy"?"buyWithAuthorization":"sellWithPermit")&&same(a[0],p.wallet)&&String(a[1])===p.amount&&String(a[2])===p.minimum);
  if(!match)throw new Error("Trade calldata does not match its frozen operation/input");
 }else throw new Error("The broadcast stage is unknown; provider history is required");
 if(r.status!=="success")return "reverted";
 const code=await lpClient.getCode({address:p.stepContract as Address,blockNumber:r.blockNumber});if(!code||code==="0x")throw new Error("No deployed operation contract exists at the receipt block");
 if(p.stage==="approval"){
  const approved=parseEventLogs({abi:erc20Abi,eventName:"Approval",logs:r.logs}).some(log=>!log.removed&&same(log.address,p.stepContract)&&same(log.args.owner,p.wallet)&&same(log.args.spender,p.tradeContract)&&String(log.args.value)===p.amount);
  if(!approved)throw new Error("The receipt has no matching actual approval event");
 }else if(p.pool){
  const filled=parseEventLogs({abi:swapperAbi,eventName:"Swapped",logs:r.logs}).some(log=>!log.removed&&same(log.address,p.tradeContract)&&String(log.args.seriesId)===String(p.seriesId)&&same(log.args.payer,p.wallet)&&same(log.args.recipient,p.wallet)&&log.args.buyCoin===(p.side==="buy")&&log.args.amountIn>BigInt(0)&&log.args.amountIn<=BigInt(p.amount)&&log.args.amountOut>=BigInt(p.minimum));
  if(!filled)throw new Error("The receipt has no matching actual pool fill");
 }else{
  const event=parseAbiItem("event Trade(address indexed trader, bool indexed isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 vU, uint256 vC, uint256 raised)");
  const filled=parseEventLogs({abi:[event],logs:r.logs}).some(log=>!log.removed&&same(log.address,p.tradeContract)&&same(log.args.trader,p.wallet)&&log.args.isBuy===(p.side==="buy")&&(p.side==="buy"?log.args.usdcAmount>BigInt(0)&&log.args.usdcAmount<=BigInt(p.amount)&&log.args.coinAmount>=BigInt(p.minimum):log.args.coinAmount===BigInt(p.amount)&&log.args.usdcAmount>=BigInt(p.minimum)));
  if(!filled)throw new Error("The receipt has no matching actual curve fill");
 }
 return p.stage==="approval"?"approval-confirmed":"trade-confirmed";
}
