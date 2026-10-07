/*
 * KOMA on Monad — Envio HyperIndex handlers.
 * Raw events → per-series aggregates (volume, fee split, holders, price, canon), daily volume, a backer
 * leaderboard and global totals. Curves and coins are registered dynamically when a series launches.
 */
import { indexer } from "envio";
import type { Backer, CanonEpisode, EvmOnEventContext, Holder, SeriesDay, Stats } from "envio";
import { NON_HOLDERS } from "../deployment";

const ZERO = BigInt(0);
const E18 = BigInt(10) ** BigInt(18);
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const DAY = 86_400;
const lc = (a: string) => a.toLowerCase();

async function global(context: EvmOnEventContext): Promise<Stats> {
  return (await context.Stats.get("global")) ?? { id: "global", series: 0, trades: 0, volumeUsdc: ZERO, comics: 0, canonEpisodes: 0, backers: 0 };
}

// ——— Launch: the series, and its curve and coin to follow ———
indexer.contractRegister({ contract: "SeriesFactory", event: "SeriesLaunched" }, async ({ event, context }) => {
  context.chain.BondingCurve.add(event.params.curve);
  context.chain.SeriesCoin.add(event.params.coin);
});

indexer.onEvent({ contract: "SeriesFactory", event: "SeriesLaunched" }, async ({ event, context }) => {
  const id = event.params.seriesId.toString();
  const p = event.params;
  context.Series.set({
    id,
    name: p.name,
    symbol: p.symbol.trim(),
    creator: lc(p.creator),
    coin: lc(p.coin),
    curve: lc(p.curve),
    characterAccount: lc(p.characterAccount),
    parentSeriesId: p.parentSeriesId,
    graduationTarget: p.graduationTarget,
    launchedAt: event.block.timestamp,
    launchTx: event.transaction.hash,
    raised: ZERO,
    priceE18: ZERO,
    complete: false,
    graduated: false,
    poolId: undefined,
    poolUsdc: undefined,
    volumeUsdc: ZERO,
    trades: 0,
    buys: 0,
    sells: 0,
    feesUsdc: ZERO,
    toCharacterUsdc: ZERO,
    toAncestorsUsdc: ZERO,
    toTreasuryUsdc: ZERO,
    graduationFeeUsdc: ZERO,
    poolVolumeUsdc: ZERO,
    holders: 0,
    proposals: 0,
    canonEpisodes: 0,
    lastTradeAt: event.block.timestamp,
  });
  context.CurveIndex.set({ id: lc(p.curve), seriesId: id });
  context.CoinIndex.set({ id: lc(p.coin), seriesId: id });
  const g = await global(context);
  context.Stats.set({ ...g, series: g.series + 1 });
});

// ——— Trades on the curve ———
async function recordTrade(
  context: EvmOnEventContext,
  o: { seriesId: string; trader: string; isBuy: boolean; usdc: bigint; coins: bigint; fee: bigint; priceE18: bigint; venue: "curve" | "pool"; timestamp: number; tx: string; id: string },
) {
  context.Trade.set({ id: o.id, seriesId: o.seriesId, trader: o.trader, isBuy: o.isBuy, usdc: o.usdc, coins: o.coins, fee: o.fee, priceE18: o.priceE18, venue: o.venue, timestamp: o.timestamp, tx: o.tx });

  const day = Math.floor(o.timestamp / DAY);
  const dayId = `${o.seriesId}-${day}`;
  const d: SeriesDay = (await context.SeriesDay.get(dayId)) ?? { id: dayId, seriesId: o.seriesId, day, volumeUsdc: ZERO, trades: 0, closePriceE18: ZERO };
  context.SeriesDay.set({ ...d, volumeUsdc: d.volumeUsdc + o.usdc, trades: d.trades + 1, closePriceE18: o.priceE18 });

  const prev: Backer | undefined = await context.Backer.get(o.trader);
  const b: Backer = prev ?? { id: o.trader, volumeUsdc: ZERO, trades: 0, buys: 0, firstTradeAt: o.timestamp, lastTradeAt: o.timestamp };
  context.Backer.set({ ...b, volumeUsdc: b.volumeUsdc + o.usdc, trades: b.trades + 1, buys: b.buys + (o.isBuy ? 1 : 0), lastTradeAt: o.timestamp });

  const g = await global(context);
  context.Stats.set({ ...g, trades: g.trades + 1, volumeUsdc: g.volumeUsdc + o.usdc, backers: g.backers + (prev ? 0 : 1) });
}

indexer.onEvent({ contract: "BondingCurve", event: "Trade" }, async ({ event, context }) => {
  const idx = await context.CurveIndex.get(lc(event.srcAddress));
  if (!idx) return;
  const s = await context.Series.get(idx.seriesId);
  if (!s) return;
  const p = event.params;
  const priceE18 = p.vC > ZERO ? (p.vU * E18) / p.vC : ZERO;
  context.Series.set({
    ...s,
    raised: p.raised,
    priceE18,
    volumeUsdc: s.volumeUsdc + p.usdcAmount,
    trades: s.trades + 1,
    buys: s.buys + (p.isBuy ? 1 : 0),
    sells: s.sells + (p.isBuy ? 0 : 1),
    feesUsdc: s.feesUsdc + p.fee,
    lastTradeAt: event.block.timestamp,
  });
  await recordTrade(context, {
    id: `${event.transaction.hash}-${event.logIndex}`,
    seriesId: s.id,
    trader: lc(p.trader),
    isBuy: p.isBuy,
    usdc: p.usdcAmount,
    coins: p.coinAmount,
    fee: p.fee,
    priceE18,
    venue: "curve",
    timestamp: event.block.timestamp,
    tx: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "BondingCurve", event: "Completed" }, async ({ event, context }) => {
  const idx = await context.CurveIndex.get(lc(event.srcAddress));
  const s = idx && (await context.Series.get(idx.seriesId));
  if (s) context.Series.set({ ...s, complete: true, raised: event.params.raised });
});

indexer.onEvent({ contract: "BondingCurve", event: "Graduated" }, async ({ event, context }) => {
  const idx = await context.CurveIndex.get(lc(event.srcAddress));
  const s = idx && (await context.Series.get(idx.seriesId));
  if (s) context.Series.set({ ...s, complete: true, graduated: true, poolId: event.params.poolId, poolUsdc: event.params.usdcToPool });
});

// ——— Trades in the graduated Uniswap v4 pool (through KomaSwapper) ———
indexer.onEvent({ contract: "KomaSwapper", event: "Swapped" }, async ({ event, context }) => {
  const id = event.params.seriesId.toString();
  const s = await context.Series.get(id);
  if (!s) return;
  const p = event.params;
  const usdc = p.buyCoin ? p.amountIn : p.amountOut;
  const coins = p.buyCoin ? p.amountOut : p.amountIn;
  const priceE18 = coins > ZERO ? (usdc * E18) / coins : s.priceE18;
  context.Series.set({ ...s, priceE18, volumeUsdc: s.volumeUsdc + usdc, poolVolumeUsdc: s.poolVolumeUsdc + usdc, trades: s.trades + 1, buys: s.buys + (p.buyCoin ? 1 : 0), sells: s.sells + (p.buyCoin ? 0 : 1), lastTradeAt: event.block.timestamp });
  await recordTrade(context, {
    id: `${event.transaction.hash}-${event.logIndex}`,
    seriesId: id,
    trader: lc(p.recipient),
    isBuy: p.buyCoin,
    usdc,
    coins,
    fee: ZERO,
    priceE18,
    venue: "pool",
    timestamp: event.block.timestamp,
    tx: event.transaction.hash,
  });
});

// ——— Holders, from coin transfers ———
indexer.onEvent({ contract: "SeriesCoin", event: "Transfer" }, async ({ event, context }) => {
  const idx = await context.CoinIndex.get(lc(event.srcAddress));
  if (!idx) return;
  const s = await context.Series.get(idx.seriesId);
  if (!s) return;
  let holders = s.holders;
  // The coin's whole supply is minted at launch, to the curve and the creator's vesting wallet; neither is a holder.
  const minted = event.params.from === ZERO_ADDR;
  const move = async (addr: string, delta: bigint) => {
    if (addr === ZERO_ADDR || lc(addr) === s.curve) return; // mint/burn and the curve's own float
    const id = `${s.id}-${lc(addr)}`;
    const h: Holder = (await context.Holder.get(id)) ?? { id, seriesId: s.id, address: lc(addr), balance: ZERO, counted: !(minted || NON_HOLDERS.has(lc(addr))) };
    const next = h.balance + delta;
    if (h.counted && h.balance === ZERO && next > ZERO) holders += 1;
    if (h.counted && h.balance > ZERO && next === ZERO) holders -= 1;
    context.Holder.set({ ...h, balance: next });
  };
  await move(event.params.from, -event.params.value);
  await move(event.params.to, event.params.value);
  context.Series.set({ ...s, holders });
});

// ——— Fees as the router splits them ———
indexer.onEvent({ contract: "RoyaltyRouter", event: "Routed" }, async ({ event, context }) => {
  // Fees are booked on the series whose trade paid them; kind 0 = its character, 1 = an ancestor, 2 = treasury.
  const s = await context.Series.get(event.params.seriesId.toString());
  if (!s) return;
  const a = event.params.amount;
  const k = Number(event.params.kind);
  context.Series.set({
    ...s,
    toCharacterUsdc: s.toCharacterUsdc + (k === 0 ? a : ZERO),
    toAncestorsUsdc: s.toAncestorsUsdc + (k === 1 ? a : ZERO),
    toTreasuryUsdc: s.toTreasuryUsdc + (k === 2 ? a : ZERO),
  });
});

indexer.onEvent({ contract: "Graduator", event: "GraduationFee" }, async ({ event, context }) => {
  const s = await context.Series.get(event.params.seriesId.toString());
  if (s) context.Series.set({ ...s, graduationFeeUsdc: s.graduationFeeUsdc + event.params.usdcFee });
});

indexer.onEvent({ contract: "Graduator", event: "PoolCreated" }, async ({ event, context }) => {
  const s = await context.Series.get(event.params.seriesId.toString());
  if (s) context.Series.set({ ...s, poolId: event.params.poolId, poolUsdc: event.params.usdcToPool });
});

// ——— Canon ———
indexer.onEvent({ contract: "CanonRegistry", event: "Proposed" }, async ({ event, context }) => {
  const sid = event.params.seriesId.toString();
  context.Proposal.set({ id: event.params.issueId.toString(), seriesId: sid, episode: Number(event.params.episode), proposer: lc(event.params.proposer), timestamp: event.block.timestamp });
  const s = await context.Series.get(sid);
  if (s) context.Series.set({ ...s, proposals: s.proposals + 1 });
});

indexer.onEvent({ contract: "CanonRegistry", event: "SlotOpened" }, async ({ event, context }) => {
  const sid = event.params.seriesId.toString();
  const id = `${sid}-${event.params.episode}`;
  const prev: CanonEpisode | undefined = await context.CanonEpisode.get(id);
  context.CanonEpisode.set({
    id,
    seriesId: sid,
    episode: Number(event.params.episode),
    opensAt: Number(event.params.snapshot),
    endsAt: Number(event.params.endsAt),
    winnerIssueId: prev?.winnerIssueId,
    votesRoot: prev?.votesRoot,
    winnerVotes: prev?.winnerVotes,
    totalVotes: prev?.totalVotes,
    finalizedAt: prev?.finalizedAt,
    settledBy: prev?.settledBy,
  });
});

indexer.onEvent({ contract: "CanonRegistry", event: "CanonFinalized" }, async ({ event, context }) => {
  const sid = event.params.seriesId.toString();
  const id = `${sid}-${event.params.episode}`;
  const prev = await context.CanonEpisode.get(id);
  context.CanonEpisode.set({
    id,
    seriesId: sid,
    episode: Number(event.params.episode),
    opensAt: prev?.opensAt ?? event.block.timestamp,
    endsAt: prev?.endsAt ?? event.block.timestamp,
    winnerIssueId: event.params.winnerIssueId,
    votesRoot: event.params.votesRoot,
    winnerVotes: event.params.winnerVotes,
    totalVotes: event.params.totalVotes,
    finalizedAt: event.block.timestamp,
    settledBy: "keeper",
  });
  const s = await context.Series.get(sid);
  if (s) context.Series.set({ ...s, canonEpisodes: s.canonEpisodes + 1 });
  const g = await global(context);
  context.Stats.set({ ...g, canonEpisodes: g.canonEpisodes + 1 });
});

// ——— Chainlink CRE: CanonSettler emits Settled right after CanonFinalized, in the same transaction ———
indexer.onEvent({ contract: "CanonSettler", event: "Settled" }, async ({ event, context }) => {
  const id = `${event.params.seriesId}-${event.params.episode}`;
  const ep = await context.CanonEpisode.get(id);
  if (ep) context.CanonEpisode.set({ ...ep, settledBy: "cre" });
});

// ——— Comics ———
indexer.onEvent({ contract: "KomaIssues", event: "IssueMinted" }, async ({ event, context }) => {
  context.Comic.set({ id: event.params.tokenId.toString(), owner: lc(event.params.to), remixOf: event.params.remixOf, pages: Number(event.params.pages), mintedAt: event.block.timestamp });
  const g = await global(context);
  context.Stats.set({ ...g, comics: g.comics + 1 });
});
