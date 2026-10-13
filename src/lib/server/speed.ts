import type { Hex, TransactionReceipt } from "viem";
import { publicClient } from "./config";
import { db } from "./store";

/**
 * Arc speed receipts: for every transaction KOMA submits (relayed trades, x402 settlements, launches, canon
 * proposals and finalizations), the time from handing it to the RPC to its receipt, the gas it used, the USDC fee
 * it paid and the block it landed in. All of it is read from the real receipt. Arc finalizes deterministically, so
 * the receipt is the final answer: there is no second "finalized" timer. The Ethereum comparison prices the same
 * gas at Ethereum mainnet's current gas price and ETH/USD (public endpoints, cached), and is left out when they
 * can't be reached.
 */
export type SpeedKind = "trade" | "x402" | "launch" | "canon" | "graduate" | "tx";
/** `ms`: send → receipt. `feeUsdc`: gas used × the effective gas price, in USDC (Arc's native gas token). */
export type Speed = { tx: Hex; kind: SpeedKind; ms: number; gasUsed: number; feeUsdc: number | null; block: number; sentAt: number };

let ready = false;
function table() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS tx_speed (
      tx TEXT PRIMARY KEY, kind TEXT NOT NULL, sent_at INTEGER NOT NULL, ms INTEGER NOT NULL, gas_used INTEGER NOT NULL, block INTEGER NOT NULL
    )`);
    if (!(d.prepare("PRAGMA table_info(tx_speed)").all() as { name: string }[]).some((c) => c.name === "fee_usdc")) d.exec("ALTER TABLE tx_speed ADD COLUMN fee_usdc REAL");
    ready = true;
  }
  return d;
}

/** Call right after the transaction was sent (`sentAt` = just before sending); waits for the receipt in the background. */
export function track(kind: SpeedKind, tx: Hex, sentAt: number) {
  void publicClient
    .waitForTransactionReceipt({ hash: tx, timeout: 90_000, pollingInterval: 50 })
    .then((r) => recordReceipt(kind, tx, r, sentAt, Date.now() - sentAt))
    .catch(() => {});
}

/** Records a receipt the sender already has. `ms` is send → receipt as the sender measured it. */
export function recordReceipt(kind: SpeedKind, tx: Hex, r: Pick<TransactionReceipt, "gasUsed" | "blockNumber" | "effectiveGasPrice">, sentAt: number, ms: number) {
  // Arc's native balance has 18 decimals and is USDC itself, so the fee in USDC is wei / 1e18.
  const feeUsdc = r.effectiveGasPrice != null ? Number(r.gasUsed * r.effectiveGasPrice) / 1e18 : null;
  table()
    .prepare("INSERT OR IGNORE INTO tx_speed (tx, kind, sent_at, ms, gas_used, block, fee_usdc) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(tx.toLowerCase(), kind, sentAt, ms, Number(r.gasUsed), Number(r.blockNumber), feeUsdc);
}

type Row = { tx: string; kind: SpeedKind; sent_at: number; ms: number; gas_used: number; fee_usdc: number | null; block: number };
const toSpeed = (r: Row): Speed => ({ tx: r.tx as Hex, kind: r.kind, ms: r.ms, gasUsed: r.gas_used, feeUsdc: r.fee_usdc, block: r.block, sentAt: r.sent_at });

export function speedOf(tx: string): Speed | null {
  const r = table().prepare("SELECT * FROM tx_speed WHERE tx = ?").get(tx.toLowerCase()) as Row | undefined;
  return r ? toSpeed(r) : null;
}

export function speedsOf(txs: string[]): Record<string, Speed> {
  const out: Record<string, Speed> = {};
  for (const t of txs) {
    const s = speedOf(t);
    if (s) out[t.toLowerCase()] = s;
  }
  return out;
}

/** The last N confirmations and their median, for the receipts page and the home page. */
export function recentSpeeds(n = 50) {
  const rows = (table().prepare("SELECT * FROM tx_speed ORDER BY sent_at DESC LIMIT ?").all(n) as Row[]).map(toSpeed);
  const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return { count: rows.length, medianMs: median, recent: rows };
}

// ——— What the same gas would cost on Ethereum mainnet right now ———
const ETH_RPC = process.env.KOMA_ETH_PRICE_RPC || "https://ethereum-rpc.publicnode.com";
let ethCache: { at: number; gasPriceWei: bigint; ethUsd: number } | null = null;

async function ethPrices() {
  if (ethCache && Date.now() - ethCache.at < 10 * 60_000) return ethCache;
  try {
    const [gas, spot] = await Promise.all([
      fetch(ETH_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
        signal: AbortSignal.timeout(4000),
      }).then((r) => r.json() as Promise<{ result?: string }>),
      fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(4000) }).then((r) => r.json() as Promise<{ data?: { amount?: string } }>),
    ]);
    const gasPriceWei = BigInt(gas.result ?? "0");
    const ethUsd = Number(spot.data?.amount);
    if (gasPriceWei > BigInt(0) && Number.isFinite(ethUsd) && ethUsd > 0) ethCache = { at: Date.now(), gasPriceWei, ethUsd };
  } catch {
    // Unreachable: the comparison is simply left out.
  }
  return ethCache;
}

/** USD that `gasUsed` costs on Ethereum mainnet at its current gas price, or null when prices can't be fetched. */
export async function ethereumCostUsd(gasUsed: number): Promise<{ usd: number; gwei: number } | null> {
  const p = await ethPrices();
  if (!p) return null;
  const wei = p.gasPriceWei * BigInt(gasUsed);
  return { usd: (Number(wei) / 1e18) * p.ethUsd, gwei: Number(p.gasPriceWei) / 1e9 };
}
