import Link from "next/link";
import type { Board } from "@/lib/server/launchpad/board";
import type { TopCreator } from "@/lib/server/launchpad/queries";
import { addressUrl, isExternal } from "@/lib/explorer";
import { short, usdAmount } from "@/lib/format";

/** Totals, the series with the most volume and the biggest backers, from the Envio indexer when it's connected. */
export function Leaderboard({ b, creators = [] }: { b: Board; creators?: TopCreator[] }) {
  const totals = [
    { k: "Volume", v: usdAmount(b.stats.volumeUsd) },
    { k: "Trades", v: b.stats.trades.toLocaleString("en-US") },
    { k: "Backers", v: b.stats.backers.toLocaleString("en-US") },
    { k: "Canon episodes", v: b.stats.canonEpisodes.toLocaleString("en-US") },
  ];
  return (
    <section aria-labelledby="leaders-h" className="mx-auto max-w-[1320px] px-4 pt-12 md:px-8 md:pt-16" data-board-source={b.source}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-2.5">
        <h2 id="leaders-h" className="font-display text-[22px] uppercase leading-none text-paper">Leaderboard</h2>
        <p className="font-mono text-[11px] text-mute">
          {b.source === "envio" ? `Indexed by Envio HyperIndex${b.indexedBlock ? ` · block ${b.indexedBlock.toLocaleString("en-US")}` : ""}` : "From KOMA's own event index"}
        </p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
        {totals.map((t) => (
          <div key={t.k}>
            <dt className="text-[11.5px] text-mute">{t.k}</dt>
            <dd className="font-mono text-[24px] text-paper">{t.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-mute">Most traded series</h3>
          {b.topSeries.length === 0 ? (
            <p className="mt-3 text-[13px] text-soft">No trades yet.</p>
          ) : (
            <ol className="mt-2">
              {b.topSeries.map((s, i) => (
                <li key={s.id} className="flex items-baseline gap-3 border-b border-rule/60 py-2 text-[13.5px]">
                  <span className="w-5 shrink-0 font-mono text-[12px] text-mute">{i + 1}</span>
                  <Link href={`/s/${s.id}`} className="min-w-0 flex-1 truncate font-semibold text-paper hover:text-kapow">
                    {s.name} <span className="font-mono text-[12px] font-normal text-kapow">${s.symbol.trim()}</span>
                  </Link>
                  <span className="shrink-0 font-mono text-[12px] text-mute">{s.trades} trades · {s.holders} holders</span>
                  <span className="w-20 shrink-0 text-right font-mono text-arb">{usdAmount(s.volumeUsd)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-mute">Top backers</h3>
          {b.topBackers.length === 0 ? (
            <p className="mt-3 text-[13px] text-soft">No backers yet.</p>
          ) : (
            <ol className="mt-2">
              {b.topBackers.map((x, i) => {
                const href = addressUrl(x.address);
                return (
                  <li key={x.address} className="flex items-baseline gap-3 border-b border-rule/60 py-2 text-[13.5px]">
                    <span className="w-5 shrink-0 font-mono text-[12px] text-mute">{i + 1}</span>
                    {href ? (
                      <a href={href} target={isExternal ? "_blank" : undefined} rel="noreferrer" title={x.address} className="min-w-0 flex-1 truncate font-mono text-soft hover:text-arb">
                        {short(x.address)}
                      </a>
                    ) : (
                      <span title={x.address} className="min-w-0 flex-1 truncate font-mono text-soft">{short(x.address)}</span>
                    )}
                    <span className="shrink-0 font-mono text-[12px] text-mute">{x.trades} trades</span>
                    <span className="w-20 shrink-0 text-right font-mono text-arb">{usdAmount(x.volumeUsd)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {creators.length > 0 && (
          <div data-top-creators>
            <h3 className="text-[12px] uppercase tracking-wide text-mute">Top creators</h3>
            <ol className="mt-2">
              {creators.map((c, i) => (
                <li key={c.address} className="flex items-baseline gap-3 border-b border-rule/60 py-2 text-[13.5px]">
                  <span className="w-5 shrink-0 font-mono text-[12px] text-mute">{i + 1}</span>
                  <Link href={`/creator/${c.address}`} className="min-w-0 flex-1 truncate font-mono text-paper hover:text-kapow">
                    {short(c.address)}
                  </Link>
                  <span className="shrink-0 font-mono text-[12px] text-mute">{c.series} series</span>
                  <span className="w-20 shrink-0 text-right font-mono text-arb" title="What their characters' wallets have earned">
                    {usdAmount(c.earnedUsdc)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
