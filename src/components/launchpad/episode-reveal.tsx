"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CanonView } from "@/lib/launchpad/types";
import { txUrl } from "@/lib/explorer";
import { short } from "@/lib/format";

type Canon = CanonView["canon"][number];
const KEY = (id: number) => `koma:seen-canon:${id}`;
const read = (id: number) => {
  try {
    const v = localStorage.getItem(KEY(id));
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};
const write = (id: number, ep: number) => {
  try {
    localStorage.setItem(KEY(id), String(ep));
  } catch {}
};

/**
 * When a round settles, the new canon episode is revealed like a splash page: the winning cover, the vote share and
 * who settled it on chain. It fires when the canon grows while the page is open, or on the next visit if a round
 * settled since this browser last saw the series. A first visit records what's there and reveals nothing.
 */
export function EpisodeReveal({ seriesId, view, characterName }: { seriesId: number; view: CanonView | null; characterName: string }) {
  const [shown, setShown] = useState<Canon | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const latest = view?.canon.reduce<Canon | null>((m, c) => (!m || c.episode > m.episode ? c : m), null) ?? null;

  useEffect(() => {
    if (!view) return;
    const top = latest?.episode ?? 0;
    const seen = read(seriesId);
    if (seen === null) return write(seriesId, top);
    if (latest && top > seen) {
      write(seriesId, top);
      const t = setTimeout(() => setShown(latest), 0);
      return () => clearTimeout(t);
    }
  }, [seriesId, view, latest]);

  useEffect(() => {
    if (!shown) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShown(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!shown) return null;
  const share = shown.totalVotes > 0 ? Math.round((shown.winnerVotes / shown.totalVotes) * 100) : 100;
  const title = shown.issue?.title ?? `Issue #${shown.issueId}`;
  // Portalled to <body> so no transformed ancestor can trap the fixed overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-h"
      data-episode-reveal={shown.episode}
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-ink/90 px-4 py-8 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && setShown(null)}
    >
      <div aria-hidden className="reveal-burst halftone pointer-events-none absolute left-1/2 top-1/2 h-[min(140vw,900px)] w-[min(140vw,900px)] -translate-x-1/2 -translate-y-1/2 rounded-full text-kapow/25 [mask-image:radial-gradient(circle,black_30%,transparent_70%)]" />
      <div className="reveal-card relative w-full max-w-[440px] border-2 border-paper bg-stock p-4 shadow-[8px_8px_0_var(--kapow-deep)]">
        <p className="font-mono text-[11.5px] uppercase tracking-wide text-kapow">The fans have voted · {characterName}</p>
        <h2 id="reveal-h" className="masthead mt-1 text-[clamp(44px,12vw,64px)] text-paper">
          Episode {shown.episode} is canon
        </h2>
        <div className="relative mt-3">
          {shown.issue?.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.issue.cover} alt={`Cover of ${title}`} className="aspect-[3/4] w-full border border-rule object-cover" />
          ) : (
            <div className="halftone flex aspect-[3/4] w-full items-center justify-center border border-rule text-kapow/40" />
          )}
          <span className="reveal-stamp absolute right-3 top-3 border-4 border-kapow bg-ink/80 px-3 py-1 font-display text-[30px] uppercase leading-none text-kapow">Canon</span>
        </div>
        <p className="mt-3 font-display text-[22px] uppercase leading-tight text-paper">{title}</p>
        <div className="mt-2" aria-label={`${share}% of the vote`}>
          <div className="flex items-baseline justify-between font-mono text-[12px] text-soft">
            <span>
              <span className="text-[18px] text-paper">{share}%</span> of the vote
            </span>
            <span>
              {shown.voters} {shown.voters === 1 ? "voter" : "voters"}
            </span>
          </div>
          <div className="mt-1 h-2 w-full bg-rule">
            <div className="reveal-bar h-full bg-kapow" style={{ width: `${share}%` }} />
          </div>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-mute">
          <span>Settled on Arc by KOMA&rsquo;s keeper</span>
          {shown.finalizedTx && (
            <a href={txUrl(shown.finalizedTx)} className="text-arb hover:underline">
              tx {short(shown.finalizedTx, 8, 4)}
            </a>
          )}
        </p>
        <div className="mt-4 flex gap-3">
          {shown.issue && (
            <Link href={`/c/${shown.issue.id}`} className="slant inline-flex h-11 flex-1 items-center justify-center text-[17px]">
              Read episode {shown.episode}
            </Link>
          )}
          <button ref={close} onClick={() => setShown(null)} className="h-11 border border-rule px-5 font-display text-[16px] uppercase text-paper hover:border-paper">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
