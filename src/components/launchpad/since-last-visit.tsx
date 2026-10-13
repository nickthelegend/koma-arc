"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/ui";
import { usdAmount } from "@/lib/format";

type Since = { since: number; now: number; trades: number; volumeUsdc: number; proposals: number; settled: number[] };
const KEY = (id: number) => `koma:last-visit:${id}`;

/**
 * "Since you were last here": chips for what changed on this series since this browser's last visit (in chain time):
 * trades, new proposals, episodes settled. Shows nothing on a first visit or when nothing changed.
 */
export function SinceLastVisit({ seriesId }: { seriesId: number }) {
  const [d, setD] = useState<Since | null>(null);
  useEffect(() => {
    let live = true;
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY(seriesId)) ?? 0);
    } catch {}
    fetch(`/api/series/${seriesId}/since${last > 0 ? `?t=${last}` : ""}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<Partial<Since>>)
      .then((j) => {
        if (!live || !j.now) return;
        try {
          localStorage.setItem(KEY(seriesId), String(j.now));
        } catch {}
        if (last > 0 && j.since) setD(j as Since);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seriesId]);
  if (!d || (d.trades === 0 && d.proposals === 0 && d.settled.length === 0)) return null;
  return (
    <p data-since-last-visit className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wide text-mute">Since your last visit</span>
      {d.settled.map((e) => (
        <a key={e} href="#story-so-far">
          <Chip tone="kapow">episode {e} is canon</Chip>
        </a>
      ))}
      {d.proposals > 0 && (
        <a href="#canon">
          <Chip tone="arb">
            {d.proposals} new {d.proposals === 1 ? "proposal" : "proposals"}
          </Chip>
        </a>
      )}
      {d.trades > 0 && (
        <Chip>
          {d.trades} {d.trades === 1 ? "trade" : "trades"} · {usdAmount(d.volumeUsdc)}
        </Chip>
      )}
    </p>
  );
}
