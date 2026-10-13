"use client";
import {withOriginTransactionLock} from "@/lib/origin-transaction-lock";
import {SubmissionBoundary} from "@/lib/submission-boundary";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { formatUnits, getAddress, parseUnits, type Hex } from "viem";
import { coinAbi, curveAbi } from "@/lib/launchpad/abi";
import { directBuy, directSell, directSwap, recoverPendingTrade, landed, lpClient, quotePool, relay, signGaslessBuy, signGaslessSell, signGaslessSwapBuy, tradeError } from "@/lib/launchpad/client";
import {readPendingTrade,savePendingTrade,clearPendingTrade,clearUnsignedTrade,pendingMatches,type PendingTrade} from "@/lib/launchpad/pending-trade";
import {UnconfirmedTradeError,requireTradeWallet} from "@/lib/launchpad/trade-guard";
import { withSlippage } from "@/lib/launchpad/intents";
import type { Addr } from "@/lib/launchpad/types";
import { txUrl } from "@/lib/explorer";
import { coinAmount, countdown, short, usdAmount } from "@/lib/format";
import { GASLESS_MIN_USDC, KOMA, TRADE_FEE_PCT } from "@/lib/network";
import { ArcMark } from "../icons";
import { useWallet, walletErrorMessage } from "../wallet";
import { FaucetHint } from "./faucet-hint";
import { SpeedReceipt } from "../speed-receipt";

const SLIPPAGE_BPS = 100;
const SNIPE_WINDOW = 600;
const SNIPE_CAP = BigInt(20_000_000) * BigInt(10) ** BigInt(18);
const BUY_PICKS = [String(GASLESS_MIN_USDC), "5", "10"];
const MIN_GASLESS = BigInt(GASLESS_MIN_USDC * 1e6);

export type TradeSeries = {
  id: number;
  symbol: string;
  curve: Addr;
  coin: Addr;
  launchedAt: number;
  /** Block time when the page loaded. */
  chainTime: number;
  complete: boolean;
  graduated: boolean;
  /** KomaSwapper and Graduator, for trading in the v4 pool after graduation. */
  swapper: Addr;
  graduator: Addr;
  quoter: Addr;
  pool: { poolId: string; usdc: number; coins: number } | null;
};

type Side = "buy" | "sell";
type Quote = { side: Side; input: bigint; out: bigint; fee: bigint; used: bigint };
type Phase = { step: "idle" | "signing" | "sending" | "confirming" | "done" | "error"; tx?: Hex; message?: string; uncertain?: boolean };

const parse = (v: string, decimals: number) => {
  try {
    const x = parseUnits(v.trim() || "0", decimals);
    return x > BigInt(0) ? x : null;
  } catch {
    return null;
  }
};

/** Buy or sell on the curve. Signing is free; KOMA's relayer sends the transaction and pays the gas. */
export function TradeWidget({ s }: { s: TradeSeries }) {
  const router = useRouter();
  const wallet = useWallet();
  const ids = useId();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const submission = useRef(false);
  const [pending, setPending] = useState<PendingTrade|null>(null);
  const [journalReady,setJournalReady]=useState(false);
  const [journalError,setJournalError]=useState<string|null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  // The snipe window is in block time; count on the chain's clock.
  const [skew] = useState(() => s.chainTime - Math.floor(Date.now() / 1000));
  const [now, setNow] = useState(() => s.chainTime);

  useEffect(()=>{
    const load=()=>{try{const current=readPendingTrade(localStorage);setPending(current);setJournalReady(true);setJournalError(null);if(current)setPhase({step:"error",tx:current.hash,uncertain:true,message:current.stage==="approval"?"An approval is unresolved. Check its receipt; the trade has not been confirmed.":"A previous transaction is unresolved. No new trade will be submitted."});}catch(error){setJournalReady(false);setJournalError(error instanceof Error?error.message:"Pending transaction storage is unavailable");}};
    load();window.addEventListener("storage",load);return()=>window.removeEventListener("storage",load);
  },[]);

  const me = wallet.address ?? undefined;
  const coinBal = useReadContract({
    address: s.coin,
    abi: coinAbi,
    functionName: "balanceOf",
    args: me ? [me] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(me), refetchInterval: 15_000 },
  });
  const eth = useBalance({ address: me, chainId: KOMA.chain.id, query: { enabled: Boolean(me), refetchInterval: 30_000 } });
  const coins = coinBal.data ?? BigInt(0);

  const sniping = now < s.launchedAt + SNIPE_WINDOW;
  useEffect(() => {
    if (!sniping) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + skew), 1000);
    return () => clearInterval(t);
  }, [sniping, skew]);

  const decimals = side === "buy" ? 6 : 18;
  const input = parse(amount, decimals);

  // Before graduation the pool doesn't exist and the curve is the market; after, the reverse.
  const pool = s.graduated;
  const currentContext=useRef({wallet:me,contract:pool?s.swapper:s.curve,seriesId:s.id,coin:s.coin,pool:Boolean(pool),curve:s.curve,swapper:s.swapper});
  currentContext.current={wallet:me,contract:pool?s.swapper:s.curve,seriesId:s.id,coin:s.coin,pool:Boolean(pool),curve:s.curve,swapper:s.swapper};
  const poolQuote = (amountIn: bigint) => quotePool({ quoter: s.quoter, graduator: s.graduator, seriesId: s.id, buyCoin: side === "buy", amountIn });

  // Live quote from the curve (or the v4 pool) itself, a moment after typing stops.
  useEffect(() => {
    if (!input || (s.complete && !pool)) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        if (pool) {
          const out = await quotePool({ quoter: s.quoter, graduator: s.graduator, seriesId: s.id, buyCoin: side === "buy", amountIn: input });
          if (live) setQuote({ side, input, out, fee: BigInt(0), used: input });
        } else if (side === "buy") {
          const [out, fee, used] = await lpClient.readContract({ address: s.curve, abi: curveAbi, functionName: "quoteBuy", args: [input] });
          if (live) setQuote({ side, input, out, fee, used });
        } else {
          const [out, fee] = await lpClient.readContract({ address: s.curve, abi: curveAbi, functionName: "quoteSell", args: [input] });
          if (live) setQuote({ side, input, out, fee, used: input });
        }
        if (live) setQuoteError(null);
      } catch (e) {
        if (live) {
          setQuote(null);
          setQuoteError(tradeError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message));
        }
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [side, input, s.curve, s.complete, pool, s.graduator, s.quoter, s.id]);

  const q = quote && input && quote.side === side && quote.input === input ? quote : null;
  const busy = ["signing", "sending", "confirming"].includes(phase.step);
  // A buy that fills the curve to its target only spends what the target needs; the rest is refunded.
  const usdcNeeded = side === "buy" && input ? Number(formatUnits(q ? q.used : input, 6)) : 0;
  const shortUsdc = Boolean(me) && wallet.usdcLoaded && side === "buy" && usdcNeeded > wallet.usdc;
  // Disconnected wallets hold nothing to sell; a connected one is only short once its balance has loaded.
  const shortCoins = side === "sell" && input !== null && (me ? coinBal.data !== undefined && input > coins : true);
  const overCap = sniping && side === "buy" && q !== null && coins + q.out > SNIPE_CAP;
  const minOut = q ? withSlippage(q.out, SLIPPAGE_BPS) : BigInt(0);
  // On Arc gas is paid in USDC (the native balance is the same USDC), so any USDC covers a wallet transaction.
  const hasGas = (eth.data?.value ?? BigInt(0)) > BigInt(0);
  // Selling into the pool is a wallet transaction (no gasless sell after graduation).
  const needsGas = pool && side === "sell";
  // KOMA relays trades for free from $1; smaller ones would cost more gas than their fee.
  const gaslessOk = !q || (side === "buy" ? (pool ? q.input : q.used) >= MIN_GASLESS : q.out >= MIN_GASLESS);
  const tradeOk = Boolean(me && q && !busy && !shortUsdc && !shortCoins && !overCap);
  const canSend = journalReady && !pending && !phase.uncertain && tradeOk && (needsGas ? hasGas : gaslessOk);
  const canSendDirect = journalReady && !pending && !phase.uncertain && tradeOk && hasGas;

  function pick(next: Side) {
    if (busy || phase.uncertain || submission.current) return;
    setSide(next);
    setAmount("");
    setQuote(null);
    setQuoteError(null);
    setPhase({ step: "idle" });
  }

  async function trade(direct: boolean) {
    try { await withOriginTransactionLock('koma:pending-trade',()=>tradeLocked(direct)); }
    catch(error){setPhase({step:"error",uncertain:true,message:error instanceof Error?error.message:"Browser transaction locking is unavailable."});}
  }

  async function tradeLocked(direct: boolean) {
    if (!q || !input || !me || submission.current || phase.uncertain || pending || !journalReady) return;
    submission.current = true;
    // A buy that would overshoot the curve's target only authorizes what the target needs,
    // so the wallet never has to hold (or sign for) USDC the curve would refund.
    const spend = !pool && side === "buy" && q.used < input ? q.used : input;
    setPhase({ step: "signing" });
    let intent:PendingTrade|undefined;
    const boundary=new SubmissionBoundary();
    try {
      if(readPendingTrade(localStorage))throw new Error("An original transaction is unresolved. Check its receipt before any new trade.");
      if(KOMA.chain.id !== 5042002)throw new Error("Durable trade recovery is available only on Arc testnet 5042002; no signature was requested.");
      let w = await wallet.walletClient();
      if (getAddress(w.account.address) !== getAddress(me)) throw new Error("Wallet changed. Request a new quote.");
      if (await w.getChainId() !== KOMA.chain.id) throw new Error("The wallet network changed. Switch to the configured Arc network before signing.");
      // Re-quote right before signing so the 1% floor is measured from the latest price.
      let min = minOut;
      if (pool) {
        min = withSlippage(await poolQuote(spend), SLIPPAGE_BPS);
      } else if (side === "buy") {
        const [out] = await lpClient.readContract({ address: s.curve, abi: curveAbi, functionName: "quoteBuy", args: [spend] });
        min = withSlippage(out, SLIPPAGE_BPS);
      } else {
        const [out] = await lpClient.readContract({ address: s.curve, abi: curveAbi, functionName: "quoteSell", args: [spend] });
        min = withSlippage(out, SLIPPAGE_BPS);
      }
      w = await wallet.walletClient();
      if (getAddress(w.account.address) !== getAddress(me)) throw new Error("Wallet changed while refreshing the quote. Request a new quote.");
      requireTradeWallet(currentContext.current.wallet ?? "", me);
      if (await w.getChainId() !== KOMA.chain.id) throw new Error("Wallet network changed while refreshing the quote.");
      intent={version:1,id:crypto.randomUUID(),chainId:5042002,wallet:me,tradeContract:pool?s.swapper:s.curve,coin:s.coin,side,amount:spend.toString(),minimum:min.toString(),seriesId:s.id,pool:Boolean(pool),direct,stage:"intent",stepContract:pool?s.swapper:s.curve,startedAt:Date.now()};
      savePendingTrade(localStorage,intent);setPending(intent);
      const observe=(stage:"approval"|"trade",contract:Addr,hash?:Hex)=>{if(!hash&&!pendingMatches(intent!,currentContext.current.wallet,KOMA.chain.id,currentContext.current.contract,currentContext.current.seriesId,currentContext.current.coin,currentContext.current.pool))throw new Error("Wallet or operation context changed; no further transaction was sent.");boundary.enter();intent={...intent!,approvalHash:stage==="trade"&&intent!.stage==="approval"&&intent!.hash?intent!.hash:intent!.approvalHash,stage,stepContract:contract,hash};setPending(intent);savePendingTrade(localStorage,intent);};
      let tx: Hex;
      if (pool) {
        if (direct || side === "sell") {
          tx = await directSwap(w, { swapper: s.swapper, seriesId: s.id, coin: s.coin, buyCoin: side === "buy", amountIn: spend, minOut: min }, observe);
        } else {
          const body = await signGaslessSwapBuy(w, { swapper: s.swapper, seriesId: s.id, buyer: w.account.address, usdcIn: spend, minCoinOut: min });
          setPhase({ step: "sending" });
          observe("trade",intent!.tradeContract as Addr);
          tx = await relay(body);
          observe("trade",intent!.tradeContract as Addr,tx);
        }
      } else if (direct) {
        tx = side === "buy" ? await directBuy(w, { curve: s.curve, usdcIn: spend, minCoinOut: min }, observe) : await directSell(w, { curve: s.curve, coin: s.coin, coinIn: spend, minUsdcOut: min }, observe);
      } else {
        const body =
          side === "buy"
            ? await signGaslessBuy(w, { curve: s.curve, buyer: w.account.address, usdcIn: spend, minCoinOut: min })
            : await signGaslessSell(w, { curve: s.curve, coin: s.coin, seller: w.account.address, coinIn: spend, minUsdcOut: min });
        setPhase({ step: "sending" });
        observe("trade",intent!.tradeContract as Addr);
        tx = await relay(body);
        observe("trade",intent!.tradeContract as Addr,tx);
      }
      setPhase({ step: "confirming", tx });
      await landed(tx);
      if(await recoverPendingTrade(intent!)!=="trade-confirmed")throw new Error("The trade reverted on-chain");
      if(!pendingMatches(intent!,currentContext.current.wallet,KOMA.chain.id,currentContext.current.contract,currentContext.current.seriesId,currentContext.current.coin,currentContext.current.pool))throw new Error("The original wallet context changed. Restore it before resolving this receipt.");
      clearPendingTrade(localStorage,intent!.id);setPending(null);
      setPhase({ step: "done", tx });
      setAmount("");
      setQuote(null);
      wallet.refreshBalance();
      void coinBal.refetch();
      router.refresh();
      // The index follows the chain a beat behind; refresh again once it has caught up.
      setTimeout(() => router.refresh(), 4000);
    } catch (e) {
      if(intent?.stage==="intent"&&!intent.hash&&!intent.approvalHash){try{boundary.releaseUnsigned(()=>{clearUnsignedTrade(localStorage,intent!);setPending(null);intent=undefined;});}catch(storageError){e=storageError;}}
      const raw = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "";
      setPhase((p) => ({ step: "error", tx: intent?.hash ?? p.tx, uncertain: Boolean(intent) || e instanceof UnconfirmedTradeError, message: /reject|denied/i.test(raw) ? walletErrorMessage(e) : tradeError(raw) }));
    } finally { submission.current = false; }
  }

  function originalContextMatches(entry: PendingTrade) {
    const context = currentContext.current;
    return pendingMatches(entry, context.wallet, KOMA.chain.id, entry.pool ? context.swapper : context.curve, context.seriesId, context.coin, entry.pool);
  }

  async function recheckReceipt() {
    try { await withOriginTransactionLock('koma:pending-trade',()=>recheckReceiptLocked()); }
    catch(error){setPhase({step:"error",tx:pending?.hash,uncertain:true,message:error instanceof Error?error.message:"Browser transaction locking is unavailable."});}
  }

  async function recheckReceiptLocked() {
    if(!pending||submission.current)return;
    if(!originalContextMatches(pending)){setPhase({step:"error",tx:pending.hash,uncertain:true,message:"This unresolved transaction belongs to a different wallet, chain or series. Restore its original context before recovery."});return;}
    const latest=readPendingTrade(localStorage);
    if(!latest||JSON.stringify(latest)!==JSON.stringify(pending))throw new Error("The original transaction changed in another tab. Reload its saved receipt before recovery.");
    submission.current=true;const entry=latest;
    setPhase({step:"confirming",tx:entry.hash,uncertain:true});
    try{
      const outcome=await recoverPendingTrade(entry);
      if(!originalContextMatches(entry))throw new Error("The wallet context changed during recovery. No journal was cleared.");
      clearPendingTrade(localStorage,entry.id);setPending(null);
      setPhase({step:outcome==="trade-confirmed"?"done":"error",tx:entry.hash,message:outcome==="approval-confirmed"?"Approval confirmed. The trade was not sent automatically; review a fresh quote before trading.":outcome==="reverted"?"Transaction finalized and reverted. No successful trade is recorded.":undefined});
      if(outcome==="trade-confirmed"){setAmount("");setQuote(null);}wallet.refreshBalance();void coinBal.refetch();router.refresh();
    }catch(error){setPhase({step:"error",tx:entry.hash,uncertain:true,message:error instanceof Error?error.message:"Could not check the existing receipt"});}
    finally{submission.current=false;}
  }

  if (s.complete && !pool && !pending && !journalError) return <Graduation s={s} />;

  const coinsFmt = (x: bigint) => coinAmount(Number(formatUnits(x, 18)));
  const usdcFmt = (x: bigint) => usdAmount(Number(formatUnits(x, 6)));

  return (
    <>
    {pool && <Graduation s={s} />}
    <section aria-labelledby={`${ids}-h`} className={`border border-rule bg-stock ${pool ? "mt-4" : ""}`}>
      <h2 id={`${ids}-h`} className="sr-only">Trade ${s.symbol}</h2>
      <div role="tablist" aria-label="Trade side" className="grid grid-cols-2 border-b border-rule">
        {(["buy", "sell"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            id={`${ids}-${k}`}
            aria-selected={side === k}
            aria-controls={`${ids}-panel`}
            onClick={() => pick(k)}
            className={`h-12 font-display text-[19px] uppercase tracking-wide ${side === k ? (k === "buy" ? "bg-arb text-ink" : "bg-paper text-ink") : "text-mute hover:text-paper"}`}
          >
            {k}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-${side}`} className="p-4">
        <label htmlFor={`${ids}-amt`} className="flex items-baseline justify-between text-[12.5px] text-mute">
          <span>{side === "buy" ? "You pay (USDC)" : `You sell ($${s.symbol})`}</span>
          {me && (
            <span className="font-mono text-[11.5px]">
              {side === "buy" ? `${wallet.usdcLoaded ? wallet.usdc.toFixed(2) : "…"} USDC` : `${coinBal.data !== undefined ? coinsFmt(coins) : "…"} $${s.symbol}`}
            </span>
          )}
        </label>
        {journalError && <p role="alert">{journalError}</p>}
        <div className="mt-1.5 flex items-stretch border border-rule bg-ink focus-within:border-soft">
          <input
            id={`${ids}-amt`}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            disabled={busy || phase.uncertain}
            onChange={(e) => {
              if (phase.uncertain || submission.current) return;
              setAmount(e.target.value.replace(/[^0-9.]/g, ""));
              if (phase.step === "done" || phase.step === "error") setPhase({ step: "idle" });
            }}
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[20px] text-paper placeholder:text-mute focus:outline-none"
          />
          {side === "sell" && (
            <button
              type="button"
              onClick={() => setAmount(formatUnits(coins, 18))}
              disabled={busy || phase.uncertain || coins === BigInt(0)}
              className="shrink-0 border-l border-rule px-3 font-display text-[14px] uppercase text-soft hover:text-paper disabled:opacity-40"
            >
              Max
            </button>
          )}
        </div>
        {side === "buy" && (
          <div className="mt-2 flex gap-2">
            {BUY_PICKS.map((v) => (
              <button key={v} type="button" onClick={() => setAmount(v)} disabled={busy || phase.uncertain} className="border border-rule px-2.5 py-1 font-mono text-[12px] text-soft hover:border-paper hover:text-paper">
                ${v}
              </button>
            ))}
          </div>
        )}

        {/* Quote: fixed height so the widget doesn't jump while it loads */}
        <dl className="mt-4 min-h-[88px] border border-rule bg-ink px-3 py-2 text-[12.5px]" aria-live="polite">
          {!input ? (
            <p className="py-5 text-center text-mute">Enter an amount for a live quote from the {pool ? "Uniswap v4 pool" : "curve"}.</p>
          ) : shortCoins ? (
            // A curve quote for coins you don't hold is meaningless (it can exceed the USDC the curve holds).
            <p className="py-5 text-center text-soft">
              {me ? `You hold ${coinsFmt(coins)} $${s.symbol}. Tap Max to sell all of it.` : `Connect your wallet to sell $${s.symbol}.`}
            </p>
          ) : q ? (
            <>
              <div className="flex justify-between gap-3 py-0.5">
                <dt className="text-mute">You get</dt>
                <dd className="font-mono text-paper">{side === "buy" ? `${coinsFmt(q.out)} $${s.symbol}` : `${usdcFmt(q.out)} USDC`}</dd>
              </div>
              <div className="flex justify-between gap-3 py-0.5">
                <dt className="text-mute">{pool ? "Pool fee" : `Fee (${TRADE_FEE_PCT}%)`}</dt>
                <dd className="font-mono text-soft">{pool ? "0.3%, included" : usdcFmt(q.fee)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-0.5">
                <dt className="text-mute">Minimum, 1% slippage</dt>
                <dd className="font-mono text-soft">{side === "buy" ? `${coinsFmt(minOut)} $${s.symbol}` : `${usdcFmt(minOut)} USDC`}</dd>
              </div>
              {side === "buy" && q.used < q.input && (
                <p className="mt-1 text-[12px] leading-snug text-bam">
                  Only {usdcFmt(q.used)} fills the curve to its target, so that&rsquo;s all you&rsquo;ll sign for.
                </p>
              )}
            </>
          ) : quoteError ? (
            <p role="alert" className="py-3 text-kapow">{quoteError}</p>
          ) : (
            <p className="animate-pulse py-5 text-center text-mute">Asking the {pool ? "pool" : "curve"}…</p>
          )}
        </dl>

        {sniping && side === "buy" && (
          <p className={`mt-3 text-[12px] leading-snug ${overCap ? "text-kapow" : "text-mute"}`}>
            {/* A live clock: the server's second and the browser's never match. */}
            Anti-snipe for <span suppressHydrationWarning>{countdown(s.launchedAt + SNIPE_WINDOW, now * 1000)}</span> more: each wallet can hold at most 20M ${s.symbol} (2% of
            supply){overCap ? `, and this buy would take you to ${coinsFmt(coins + q!.out)}.` : "."}
          </p>
        )}

        <div className="mt-4">
          {!me ? (
            <button onClick={wallet.connect} disabled={wallet.connecting} className="slant w-full py-3.5 text-[20px]">
              {wallet.connecting ? "Connecting…" : "Connect wallet to trade"}
            </button>
          ) : shortUsdc ? (
            <FaucetHint need={usdcNeeded} />
          ) : (
            <>
              <button onClick={() => trade(false)} disabled={!canSend} className={`slant w-full py-3.5 text-[20px] ${side === "buy" ? "slant-arb" : ""}`}>
                {phase.step === "signing"
                  ? "Confirm in your wallet…"
                  : phase.step === "sending"
                    ? "Sending…"
                    : phase.step === "confirming"
                      ? "Landing on Arc…"
                      : shortCoins
                        ? `Not enough $${s.symbol}`
                        : needsGas
                          ? hasGas
                            ? "Sell into the pool"
                            : "Needs a little USDC for gas"
                          : !gaslessOk
                            ? `Gasless from $${GASLESS_MIN_USDC}`
                            : side === "buy"
                            ? "Sign & buy — no gas"
                            : "Sign & sell — no gas"}
              </button>
              <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-mute">
                <ArcMark width={12} height={12} />{" "}
                {needsGas
                  ? "Selling into the v4 pool is a wallet transaction; your wallet pays a fraction of a cent of gas in USDC"
                  : !gaslessOk
                    ? `KOMA pays the gas on trades of $${GASLESS_MIN_USDC} or more. Smaller ones go through your own wallet.`
                    : `${side === "buy" ? "One USDC signature" : "Two signatures (permit + sell)"} · KOMA’s relayer pays the gas`}
              </p>
              {hasGas && !needsGas && (
                <button
                  onClick={() => trade(true)}
                  disabled={!canSendDirect}
                  className="mx-auto mt-2 block text-[12.5px] text-soft underline decoration-rule underline-offset-4 hover:text-paper disabled:opacity-40"
                >
                  Send it yourself (your wallet pays the gas, in USDC)
                </button>
              )}
            </>
          )}
          {wallet.error && !me && <p role="alert" className="mt-2 text-[12.5px] text-kapow">{wallet.error}</p>}
        </div>

        {phase.step !== "idle" && phase.step !== "signing" && (
          <div
            role={phase.step === "error" ? "alert" : "status"}
            className={`mt-4 border px-3 py-2.5 text-[12.5px] leading-snug ${phase.step === "error" ? "border-kapow/60 bg-kapow/10 text-paper" : "border-arb/30 bg-[#06111a] text-soft"}`}
          >
            {phase.step === "error" ? phase.message : phase.step === "done" ? "Done. Your balance updates as the page refreshes." : phase.step === "sending" ? "Handing your signature to the relayer…" : "Waiting for the block…"}
            {phase.uncertain && phase.step === "error" && <button onClick={() => void recheckReceipt()} className="mt-2 underline">Check existing receipt</button>}
            {pending?.approvalHash && <a href={txUrl(pending.approvalHash)} target="_blank" rel="noreferrer" className="mt-1 block underline">Confirmed approval receipt (the trade remains unresolved)</a>}
            {phase.tx && (
              <a href={txUrl(phase.tx)} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-arb hover:underline">
                tx {short(phase.tx, 10, 6)}
              </a>
            )}
            {phase.step === "done" && phase.tx && <SpeedReceipt tx={phase.tx} who="KOMA's relayer" className="mt-1.5" />}
          </div>
        )}
      </div>
    </section>
    </>
  );
}

/** A complete curve: the graduation into Uniswap v4, or the button that triggers it. */
function Graduation({ s }: { s: TradeSeries }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; tx?: Hex; error?: string }>({ busy: false });

  async function graduate() {
    setState({ busy: true });
    try {
      const res = await fetch(`/api/series/${s.id}/graduate`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { txHash?: Hex; error?: string } | null;
      if (!res.ok || !body?.txHash) {
        // Someone (usually the keeper) got there first.
        if (res.status === 409 && /already/i.test(body?.error ?? "")) router.refresh();
        throw new Error(body?.error ?? `The server answered ${res.status}.`);
      }
      setState({ busy: true, tx: body.txHash });
      await landed(body.txHash);
      setState({ busy: false, tx: body.txHash });
      router.refresh();
      setTimeout(() => router.refresh(), 4000);
    } catch (e) {
      setState((p) => ({ busy: false, tx: p.tx, error: tradeError((e as Error).message) }));
    }
  }

  return (
    <section aria-label="Graduation" className="border border-arb/30 bg-[#06111a] p-4">
      <p className="flex items-center gap-2 font-display text-[20px] uppercase tracking-wide text-arb">
        <ArcMark /> {s.graduated ? "Graduated to Uniswap v4" : "Curve complete"}
      </p>
      {s.graduated ? (
        <>
          <p className="mt-2 text-[13.5px] leading-relaxed text-soft">
            The curve reached its target and its reserves moved into a full-range Uniswap v4 pool (0.3% fee). The liquidity position
            was sent to a dead address, so it can never be pulled. The curve itself no longer trades.
          </p>
          {s.pool && (
            <dl className="mt-3 text-[12.5px]">
              {[
                ["Pool id", short(s.pool.poolId, 10, 6)],
                ["USDC seeded at graduation", usdAmount(s.pool.usdc)],
                [`$${s.symbol} seeded`, coinAmount(s.pool.coins)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-t border-arb/15 py-2 first:border-t-0">
                  <dt className="text-mute">{k}</dt>
                  <dd className="font-mono text-paper" title={k === "Pool id" ? s.pool!.poolId : undefined}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-[13.5px] leading-relaxed text-soft">
            The curve hit its target, so trading on it has stopped. Graduation moves its USDC and remaining coins into a Uniswap v4
            pool at the final curve price. KOMA does this on its own within a minute; anyone can trigger it now.
          </p>
          <button onClick={graduate} disabled={state.busy} className="slant slant-arb mt-4 w-full py-3 text-[18px]">
            {state.busy ? (state.tx ? "Landing on Arc…" : "Graduating…") : "Graduate now"}
          </button>
        </>
      )}
      {state.tx && (
        <a href={txUrl(state.tx)} target="_blank" rel="noreferrer" className="mt-3 block font-mono text-[12.5px] text-arb hover:underline">
          tx {short(state.tx, 10, 6)}
        </a>
      )}
      {state.error && <p role="alert" className="mt-3 text-[12.5px] text-kapow">{state.error}</p>}
    </section>
  );
}
