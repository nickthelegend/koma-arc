"use client";

import { useEffect, useState } from "react";
import { ArcMark } from "./icons";
import { Chip, Details } from "./ui";

type Speed = { pending: boolean; ms?: number; gasUsed?: number; feeUsdc?: number | null; block?: number; ethereum?: { usd: number; gwei: number } | null };

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `<$0.01`);
const fee = (n: number) => (n >= 0.01 ? `${n.toFixed(3)} USDC` : n >= 0.0001 ? `${n.toFixed(4)} USDC` : `<0.0001 USDC`);

/**
 * "Executed on Arc in 412 ms": a transaction's real send → receipt time, the block, the USDC fee KOMA paid, and what
 * the same gas would cost on Ethereum mainnet right now. Arc finalizes deterministically, so the receipt is final.
 * Polls until the server has seen the receipt.
 */
export function SpeedReceipt({ tx, who = "KOMA", className = "" }: { tx: string; who?: string; className?: string }) {
  const [s, setS] = useState<Speed | null>(null);
  useEffect(() => {
    let live = true;
    let tries = 0;
    const poll = async () => {
      const r = (await fetch(`/api/speed/${tx}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null)) as Speed | null;
      if (!live) return;
      if (r && !r.pending) setS(r);
      else if (++tries < 40) setTimeout(poll, 400);
    };
    const first = setTimeout(poll, 0);
    return () => {
      live = false;
      clearTimeout(first);
    };
  }, [tx]);
  if (!s?.ms) return null;
  // One headline (the time), one supporting line (who paid, one comparison); block, gas and caveats under Details.
  return (
    <div data-speed-receipt className={`font-mono text-[11.5px] leading-relaxed ${className}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ArcMark width={14} height={14} />
        <span className="text-[15px] text-paper">
          Final in <span className="text-arb">{s.ms.toLocaleString("en-US")} ms</span>
        </span>
        <Chip title="Arc finalizes deterministically: once a transaction is in a block it cannot be reorganised">final on inclusion</Chip>
      </p>
      <p className="pl-[22px] text-mute">
        {s.feeUsdc != null ? `${fee(s.feeUsdc)} gas paid by ${who}` : `gas paid by ${who}`}
        {s.ethereum ? ` · est. ≈ ${usd(s.ethereum.usd)} for the same gas on Ethereum` : ""}
      </p>
      <Details className="pl-[22px]">
        <ul className="font-mono text-[11px]">
          <li>block #{s.block?.toLocaleString("en-US")}</li>
          <li>
            {s.gasUsed?.toLocaleString("en-US")} gas, paid in USDC by {who}
          </li>
          {s.ethereum && (
            <li className="max-w-prose whitespace-normal">
              Ethereum figure is an estimate, not a quote: this transaction&rsquo;s gas units &times; Ethereum mainnet&rsquo;s current gas price
              ({s.ethereum.gwei.toFixed(2)} gwei, <code>eth_gasPrice</code> from ethereum-rpc.publicnode.com) &times; the Ethereum-to-USD spot price from
              Coinbase, cached for 10 minutes. Real cost differs with gas usage on Ethereum and price moves.
            </li>
          )}
        </ul>
      </Details>
    </div>
  );
}
