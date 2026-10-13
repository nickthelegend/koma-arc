import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { creatorStats } from "@/lib/server/launchpad/queries";
import type { Addr } from "@/lib/launchpad/types";
import { short, usdAmount } from "@/lib/format";
import { addressUrl } from "@/lib/explorer";
import { Chip, Details } from "@/components/ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = (await params).address;
  return isAddress(a) ? { title: `Creator ${short(a)}`, description: `The series ${short(a)} launched on KOMA, and what its characters have earned.` } : {};
}

/** Earnings per day as bars (no chart library: 30 rects). */
function Bars({ daily }: { daily: { day: number; usdc: number }[] }) {
  const max = Math.max(...daily.map((d) => d.usdc), 0);
  const W = 600;
  const H = 120;
  const bw = W / daily.length;
  const label = (day: number) => new Date(day * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <figure data-earnings-chart>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={`Character earnings per day, last ${daily.length} days, peak ${usdAmount(max)}`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--rule)" />
        {daily.map((d, i) => {
          const h = max > 0 ? Math.max(d.usdc > 0 ? 2 : 0, (d.usdc / max) * (H - 8)) : 0;
          return (
            <rect key={d.day} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} fill="var(--arb)">
              <title>{`${label(d.day)}: ${usdAmount(d.usdc)}`}</title>
            </rect>
          );
        })}
        <text x="0" y={H + 14} fill="var(--mute)" fontSize="10">{label(daily[0].day)}</text>
        <text x={W} y={H + 14} fill="var(--mute)" fontSize="10" textAnchor="end">{label(daily[daily.length - 1].day)}</text>
      </svg>
    </figure>
  );
}

/** A creator's page: everything they launched and what their characters earn, from KOMA's index of the chain. */
export default async function CreatorPage({ params }: Props) {
  const raw = (await params).address;
  if (!isAddress(raw) || !launchpad()) notFound();
  const address = getAddress(raw) as Addr;
  const s = creatorStats(address);
  const link = addressUrl(address);

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
      <p className="text-[12.5px] text-mute">Creator</p>
      <h1 className="masthead text-[14vw] text-kapow sm:text-[clamp(56px,7vw,96px)]">{short(address)}</h1>
      {s.series.length === 0 ? (
        <div className="mt-8 border border-dashed border-rule px-6 py-10 text-center">
          <p className="font-display text-[24px] uppercase text-paper">No series yet</p>
          <p className="mt-2 text-[14px] text-soft">Launching a character costs $1.</p>
          <Link href="/launch" className="slant mt-5 inline-flex h-11 px-6 text-[17px]">
            Launch a series
          </Link>
        </div>
      ) : (
        <>
          <div data-creator-totals className="mt-8 border-y border-rule py-5">
            <p className="text-[12px] text-mute">Characters earned</p>
            <p data-creator-earned className="font-display text-[56px] leading-none text-arb md:text-[72px]">{usdAmount(s.totals.earnedUsdc)}</p>
            <p className="mt-3 flex flex-wrap gap-1.5">
              <Chip>{s.totals.series} series</Chip>
              <Chip>{usdAmount(s.totals.volumeUsdc)} volume</Chip>
              <Chip>{s.totals.episodes} canon</Chip>
              {s.totals.fromRemixesUsdc > 0 && <Chip tone="arb">{usdAmount(s.totals.fromRemixesUsdc)} from remixes</Chip>}
            </p>
          </div>

          <section className="mt-8" aria-labelledby="earn-h">
            <h2 id="earn-h" className="font-display text-[20px] uppercase leading-none text-paper">
              Last 30 days
            </h2>
            <div className="mt-3">
              <Bars daily={s.daily} />
            </div>
          </section>

          <section className="mt-8" aria-labelledby="series-h">
            <h2 id="series-h" className="font-display text-[20px] uppercase leading-none text-paper">
              Series
            </h2>
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {s.series.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <Link href={`/s/${x.id}`} className="min-w-0 flex-1 truncate text-[14px] font-semibold text-paper hover:text-kapow">
                    {x.name} <span className="font-mono text-[12px] font-normal text-kapow">${x.symbol.trim()}</span>
                  </Link>
                  {x.graduated && <Chip tone="arb">graduated</Chip>}
                  <Chip>{x.holders} holders</Chip>
                  <span className="w-24 text-right font-mono text-[15px] text-arb">{usdAmount(x.earnedUsdc)}</span>
                </li>
              ))}
            </ul>
          </section>

          <Details className="mt-6">
            <dl className="grid gap-x-6 gap-y-1 font-mono text-[11.5px] sm:grid-cols-[auto_1fr]">
              <dt>Address</dt>
              <dd className="break-all">{link ? <a href={link} target="_blank" rel="noreferrer" className="text-arb hover:underline">{address}</a> : address}</dd>
              {s.series.map((x) => (
                <div key={x.id} className="contents">
                  <dt>${x.symbol.trim()}</dt>
                  <dd>
                    {usdAmount(x.earnedUsdc)} earned ({usdAmount(x.fromRemixesUsdc)} from remixes) · {usdAmount(x.volumeUsdc)} volume · {x.episodes} canon
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2">Earnings are the character wallets&rsquo; share of each trade&rsquo;s fee (Routed events), indexed from the chain.</p>
          </Details>
        </>
      )}
    </div>
  );
}
