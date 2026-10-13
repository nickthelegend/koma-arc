"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CoverCard } from "@/components/cover-card";
import { useWallet } from "@/components/wallet";
import { IconPen } from "@/components/icons";
import { FirstSteps } from "@/components/first-steps";
import { coinAmount, usdAmount } from "@/lib/format";
import { short } from "@/lib/format";
import type { Comic, JobStage } from "@/lib/types";

type Holding = { id: number; name: string; symbol: string; characterName: string; sheetUrl: string; coins: number; valueUsdc: number };
type ActiveJob = { id: string; stage: JobStage; title: string | null; drawn: number; total: number };

export default function Shelf() {
  const { address, connect, connecting, error } = useWallet();
  const [mine, setMine] = useState<{ owner: string; list: Comic[]; active: ActiveJob[]; holdings: Holding[] } | null>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    Promise.all([
      fetch(`/api/comics?owner=${address}`).then((r) => r.json() as Promise<{ comics: Comic[] }>),
      fetch(`/api/jobs?payer=${address}`).then((r) => r.json() as Promise<{ jobs: ActiveJob[] }>),
      fetch(`/api/holdings?address=${address}`)
        .then((r) => r.json() as Promise<{ holdings?: Holding[] }>)
        .catch(() => ({ holdings: [] })),
    ])
      .then(([c, j, h]) => live && setMine({ owner: address, list: c.comics, active: j.jobs, holdings: h.holdings ?? [] }))
      .catch(() => live && setMine({ owner: address, list: [], active: [], holdings: [] }));
    return () => {
      live = false;
    };
  }, [address]);

  const list = mine && mine.owner === address ? mine.list : null;
  const active = mine && mine.owner === address ? mine.active : [];
  const holdings = mine && mine.owner === address ? mine.holdings : null;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
      <h1 className="masthead text-[30vw] text-kapow md:text-[clamp(140px,15vw,216px)]">Shelf</h1>

      {!address ? (
        <div className="mt-8 max-w-[520px]">
          <p className="text-[16px] leading-relaxed text-soft">
            Your shelf is every issue minted to your wallet on Arc. Connect to see yours. Reading is free and never needs a wallet.
          </p>
          <button onClick={connect} disabled={connecting} className="slant mt-6 h-12 px-7 text-[19px]">
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
          {error && <p role="alert" className="mt-4 text-[13.5px] text-kapow">{error}</p>}
        </div>
      ) : (
        <>
          <p className="mt-4 text-[14px] text-mute" aria-live="polite">
            {list === null
              ? "Pulling your issues…"
              : `${list.length} ${list.length === 1 ? "issue" : "issues"} minted to `}
            {list !== null && <span className="font-mono text-soft">{short(address)}</span>}
          </p>
          {list !== null && holdings !== null && <FirstSteps issues={list.length + active.length} holdings={holdings.length} />}
          {holdings !== null && holdings.length > 0 && (
            <section data-holdings aria-labelledby="coins-h" className="mt-8">
              <h2 id="coins-h" className="font-display text-[22px] uppercase leading-none text-paper">
                Characters you back
              </h2>
              <ul className="mt-3 divide-y divide-rule border-y border-rule">
                {holdings.map((h) => (
                  <li key={h.id}>
                    <Link href={`/s/${h.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-stock">
                      {h.sheetUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={h.sheetUrl} alt="" className="h-10 w-10 border border-rule object-cover" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-semibold text-paper">
                        {h.characterName} <span className="font-mono text-[12px] font-normal text-kapow">${h.symbol.trim()}</span>
                      </span>
                      <span className="font-mono text-[12.5px] text-soft">{coinAmount(h.coins)} coins</span>
                      <span className="w-24 text-right font-mono text-[12.5px] text-arb">{usdAmount(h.valueUsdc)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
            {active.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/create?job=${j.id}`}
                  className="flex aspect-[3/4] flex-col justify-end gap-2 border-2 border-kapow/70 bg-stock p-4 hover:border-kapow"
                >
                  <span className="halftone mb-auto h-16 w-16 animate-ink rounded-full text-kapow/60" aria-hidden />
                  <span className="text-[12px] text-kapow">Still being made · {j.stage === "drawing" ? `${j.drawn} of ${j.total} panels` : j.stage}</span>
                  <span className="font-display text-[20px] uppercase leading-tight text-paper">{j.title ?? "Untitled issue"}</span>
                </Link>
              </li>
            ))}
            {(list ?? []).map((c, i) => (
              <li key={c.id}>
                <CoverCard comic={c} index={i} />
              </li>
            ))}
            {/* An empty shelf already says "make your first issue" in Start here; don't say it twice. */}
            {(list === null || list.length + active.length > 0) && (
              <li>
                <Link
                  href="/create"
                className="flex aspect-[3/4] flex-col items-center justify-center gap-3 border-2 border-dashed border-rule text-mute hover:border-kapow hover:text-kapow"
              >
                <IconPen width={26} height={26} />
                <span className="font-display text-[18px] uppercase">{list?.length ? "Make a new issue" : "Make your first issue"}</span>
                </Link>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
