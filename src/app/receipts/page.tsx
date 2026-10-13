import { CcipReceipts } from "@/components/ccip-receipts";
import Link from "next/link";
import type { Metadata } from "next";
import { allComics } from "@/lib/catalog";
import { ArcMark } from "@/components/icons";
import { ago, short } from "@/lib/format";
import { txUrl } from "@/lib/explorer";
import { recentSpeeds, speedsOf } from "@/lib/server/speed";
import { Chip, Details } from "@/components/ui";

export const metadata: Metadata = {
  title: "Receipts",
  description: "Every KOMA issue, the USDC paid for it over x402, and the Arc transactions that settled and minted it.",
};

export const dynamic = "force-dynamic";

export default async function Receipts() {
  const rows = [...(await allComics())].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = rows.reduce((s, c) => s + Number(c.chain.paidUsdc), 0);
  const pages = rows.reduce((s, c) => s + c.pageCount, 0);
  // Arc speed receipts: each settlement's real send → receipt time (src/lib/server/speed.ts).
  const speeds = speedsOf(rows.map((c) => c.chain.paymentTx));
  const settledIn = (tx: string) => speeds[tx.toLowerCase()]?.ms;
  const { medianMs } = recentSpeeds(200);

  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
      <h1 className="masthead text-[25vw] text-kapow md:text-[clamp(140px,15vw,216px)]">Receipts</h1>
      <div className="mt-6 border-y border-rule py-4">
        <p className="text-[12px] text-mute">USDC settled over x402</p>
        <p className="font-display text-[56px] leading-none text-arb md:text-[72px]">{total.toFixed(2)}</p>
        <p className="mt-3 flex flex-wrap gap-1.5">
          <Chip>{rows.length} issues minted</Chip>
          <Chip>{pages} pages drawn</Chip>
          {medianMs != null && <Chip tone="arb">Median confirmation {medianMs} ms</Chip>}
        </p>
        <Details className="mt-3">
          Each issue is one HTTP 402 payment settled in USDC on Arc, then one mint. &ldquo;Settled in&rdquo; is the real send →
          receipt time of each settlement, and on Arc the receipt is final.
        </Details>
      </div>

      {rows.length === 0 && (
        <p className="mt-10 border border-dashed border-rule px-6 py-12 text-center text-[15px] text-mute">
          The ledger is empty. The first payment lands here the moment someone makes an issue.
        </p>
      )}

      {/* Phone: stacked slips. Desktop: a ledger table. */}
      <ul className="mt-6 divide-y divide-rule md:hidden">
        {rows.map((c) => (
          <li key={c.id} className="py-4">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/c/${c.id}`} className="font-display text-[20px] uppercase leading-tight text-paper">{c.title}</Link>
              <span className="font-mono text-[13px] text-arb">{c.chain.paidUsdc} USDC</span>
            </div>
            <p className="mt-1 text-[12.5px] text-mute">{ago(c.createdAt)}</p>
            <a href={txUrl(c.chain.paymentTx)} className="mt-1 flex items-center gap-1.5 font-mono text-[11.5px] text-arb">
              <ArcMark width={12} height={12} /> {short(c.chain.paymentTx, 10, 8)}
              {settledIn(c.chain.paymentTx) != null && <span className="text-mute">· settled in {settledIn(c.chain.paymentTx)} ms</span>}
            </a>
          </li>
        ))}
      </ul>

      <table className={`mt-8 hidden w-full text-left text-[13.5px] ${rows.length ? "md:table" : ""}`}>
        <thead>
          <tr className="border-b border-rule text-[12px] text-mute">
            <th className="py-3 font-medium">Issue</th>
            <th className="py-3 text-right font-medium">Paid</th>
            <th className="py-3 pl-8 font-medium">Payment tx</th>
            <th className="py-3 text-right font-medium">Settled in</th>
            <th className="py-3 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-rule/60 hover:bg-stock">
              <td className="py-3.5">
                <Link href={`/c/${c.id}`} className="font-display text-[17px] uppercase tracking-wide text-paper hover:text-kapow">
                  {c.title}
                </Link>
              </td>
              <td className="py-3.5 text-right font-mono text-arb">{c.chain.paidUsdc} USDC</td>
              <td className="py-3.5 pl-8 font-mono text-[12.5px] text-soft">
                <a href={txUrl(c.chain.paymentTx)} className="text-arb hover:underline">
                  {short(c.chain.paymentTx, 10, 8)}
                </a>
              </td>
              <td className="py-3.5 text-right font-mono text-[12.5px] text-arb">{settledIn(c.chain.paymentTx) != null ? `${settledIn(c.chain.paymentTx)} ms` : "—"}</td>
              <td className="py-3.5 text-right text-mute">{ago(c.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CcipReceipts />
    </div>
  );
}
