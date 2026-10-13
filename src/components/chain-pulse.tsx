"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KOMA } from "@/lib/network";

type Head = { block: number | null; blockMs: number | null; medianMs: number | null };

/** The chain advancing, live: the latest block and the measured block interval. The dot blinks on each new block. */
export function ChainPulse() {
  const [head, setHead] = useState<Head | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    let last: number | null = null;
    const poll = async () => {
      const h = (await fetch("/api/speed", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as Head | null;
      if (!live || !h) return;
      if (h.block !== last) setTick((t) => t + 1);
      last = h.block;
      setHead(h);
    };
    const first = setTimeout(poll, 0);
    const t = setInterval(poll, 1500);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return (
    <Link href="/receipts" className="hidden items-center gap-1.5 font-mono text-[11.5px] text-mute hover:text-paper lg:flex" title="Live from the chain: latest block and the measured block interval. Measured confirmation times: /receipts">
      <span key={tick} className="h-1.5 w-1.5 animate-[pulse-dot_0.6s_ease-out] rounded-full bg-arb" aria-hidden />
      <span className="font-sans text-[12px]">{KOMA.label}</span>
      {head?.block != null && (
        <>
          <span aria-label={`block ${head.block}`}>#{head.block.toLocaleString("en-US")}</span>
          {head.blockMs != null && <span>· {(head.blockMs / 1000).toFixed(1)} s blocks</span>}
        </>
      )}
    </Link>
  );
}
