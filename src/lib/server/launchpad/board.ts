import { formatUnits } from "viem";
import type { Addr } from "@/lib/launchpad/types";
import { db } from "./db";

/**
 * The board's leaderboard: global totals, the series with the most volume and the biggest backers.
 *
 * With ENVIO_GRAPHQL_URL set it comes from the Envio HyperIndex indexer (indexer/), which aggregates every
 * curve trade, pool swap, holder balance and canon round on Monad. Without it, or if the indexer is down or
 * behind, the same numbers are computed from KOMA's own SQLite event cache, so the board never goes blank.
 */
export type Board = {
  source: "envio" | "local";
  /** Last block the indexer has processed (Envio only). */
  indexedBlock: number | null;
  stats: { series: number; trades: number; volumeUsd: number; backers: number; canonEpisodes: number };
  topSeries: { id: number; name: string; symbol: string; volumeUsd: number; trades: number; holders: number }[];
  topBackers: { address: Addr; volumeUsd: number; trades: number }[];
};

const usd = (raw: string | bigint) => Number(formatUnits(BigInt(raw), 6));
const TOP = 5;

const QUERY = `query Board($top: Int!) {
  Stats(where: { id: { _eq: "global" } }) { series trades volumeUsdc backers canonEpisodes }
  Series(limit: $top, order_by: [{ volumeUsdc: desc }, { id: asc }], where: { trades: { _gt: 0 } }) { id name symbol volumeUsdc trades holders }
  Backer(limit: $top, order_by: [{ volumeUsdc: desc }, { id: asc }]) { id volumeUsdc trades }
  _meta { progressBlock isReady }
}`;

type EnvioData = {
  Stats: { series: number; trades: number; volumeUsdc: string; backers: number; canonEpisodes: number }[];
  Series: { id: string; name: string; symbol: string; volumeUsdc: string; trades: number; holders: number }[];
  Backer: { id: string; volumeUsdc: string; trades: number }[];
  _meta: { progressBlock: number; isReady: boolean }[];
};

export const envioUrl = () => (process.env.ENVIO_GRAPHQL_URL ?? "").trim();

async function fromEnvio(url: string): Promise<Board | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { top: TOP } }),
    signal: AbortSignal.timeout(2500),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: EnvioData; errors?: unknown[] };
  const d = j.data;
  if (!d || j.errors?.length) return null;
  const meta = d._meta[0];
  // Still backfilling: its totals would undercount, so use the local cache until it catches up.
  if (meta && !meta.isReady) return null;
  const s = d.Stats[0];
  return {
    source: "envio",
    indexedBlock: meta?.progressBlock ?? null,
    stats: s
      ? { series: s.series, trades: s.trades, volumeUsd: usd(s.volumeUsdc), backers: s.backers, canonEpisodes: s.canonEpisodes }
      : { series: 0, trades: 0, volumeUsd: 0, backers: 0, canonEpisodes: 0 },
    topSeries: d.Series.map((r) => ({ id: Number(r.id), name: r.name, symbol: r.symbol, volumeUsd: usd(r.volumeUsdc), trades: r.trades, holders: r.holders })),
    topBackers: d.Backer.map((r) => ({ address: r.id as Addr, volumeUsd: usd(r.volumeUsdc), trades: r.trades })),
  };
}

function fromLocal(): Board {
  const d = db();
  const sumUsd = (rows: { usdc: string }[]) => rows.reduce((a, r) => a + BigInt(r.usdc), BigInt(0));
  const trades = d.prepare("SELECT series_id, trader, usdc FROM lp_trades").all() as { series_id: number; trader: string; usdc: string }[];
  const bySeries = new Map<number, { usdc: bigint; trades: number }>();
  const byBacker = new Map<string, { usdc: bigint; trades: number }>();
  for (const t of trades) {
    const s = bySeries.get(t.series_id) ?? { usdc: BigInt(0), trades: 0 };
    s.usdc += BigInt(t.usdc);
    s.trades++;
    bySeries.set(t.series_id, s);
    const b = byBacker.get(t.trader.toLowerCase()) ?? { usdc: BigInt(0), trades: 0 };
    b.usdc += BigInt(t.usdc);
    b.trades++;
    byBacker.set(t.trader.toLowerCase(), b);
  }
  const names = new Map(
    (d.prepare("SELECT id, name, symbol FROM lp_series").all() as { id: number; name: string; symbol: string }[]).map((r) => [r.id, r]),
  );
  const holders = new Map(
    (d.prepare("SELECT series_id, COUNT(*) AS n FROM lp_balances WHERE balance != '0' GROUP BY series_id").all() as { series_id: number; n: number }[]).map((r) => [
      r.series_id,
      r.n,
    ]),
  );
  const desc = <T extends { usdc: bigint }>(a: [unknown, T], b: [unknown, T]) => (b[1].usdc > a[1].usdc ? 1 : b[1].usdc < a[1].usdc ? -1 : 0);
  return {
    source: "local",
    indexedBlock: null,
    stats: {
      series: names.size,
      trades: trades.length,
      volumeUsd: usd(sumUsd(trades)),
      backers: byBacker.size,
      canonEpisodes: (d.prepare("SELECT COUNT(*) AS n FROM lp_slots WHERE finalized = 1").get() as { n: number }).n,
    },
    topSeries: [...bySeries]
      .sort(desc)
      .slice(0, TOP)
      .map(([id, v]) => ({ id, name: names.get(id)?.name ?? `#${id}`, symbol: names.get(id)?.symbol ?? "", volumeUsd: usd(v.usdc), trades: v.trades, holders: holders.get(id) ?? 0 })),
    topBackers: [...byBacker]
      .sort(desc)
      .slice(0, TOP)
      .map(([address, v]) => ({ address: address as Addr, volumeUsd: usd(v.usdc), trades: v.trades })),
  };
}

export async function board(): Promise<Board> {
  const url = envioUrl();
  if (url) {
    const b = await fromEnvio(url).catch(() => null);
    if (b) return b;
  }
  return fromLocal();
}
