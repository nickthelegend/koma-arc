import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { listSeries } from "@/lib/server/launchpad/queries";
import { coinPrice, progressLabel } from "@/lib/format";
import { RaisedBar } from "@/components/launchpad/sheet";
import { Chip } from "@/components/ui";
import { ArcMark } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * A series as a live card for someone else's site: `<iframe src="/embed/s/<id>">`. Real numbers from KOMA's index,
 * one headline (the character), one supporting line, and a link back. No site chrome (see globals.css).
 */
export default async function EmbedSeries({ params }: Props) {
  const id = Number((await params).id);
  const s = launchpad() ? listSeries().find((x) => x.id === id) : undefined;
  if (!s) notFound();
  return (
    <a data-embed={s.id} href={`/s/${s.id}`} target="_blank" rel="noreferrer" className="block max-w-[420px] border-2 border-paper bg-stock p-3 text-paper hover:border-kapow">
      {s.sheetUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.sheetUrl} alt={`${s.characterName}'s character sheet`} className="aspect-video w-full border border-rule object-cover" />
      )}
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-kapow">${s.symbol.trim()} · KOMA</p>
      <p className="masthead text-[34px] leading-[0.9]">{s.characterName}</p>
      <p className="mt-1 truncate text-[13px] text-soft">{s.name}</p>
      {s.graduated ? (
        <p className="mt-2">
          <Chip tone="arb">graduated · Uniswap v4</Chip>
        </p>
      ) : (
        <div className="mt-2">
          <RaisedBar raised={s.raisedUsdc} target={s.targetUsdc} label={false} />
          <p className="mt-1 font-mono text-[11px] text-mute">{progressLabel(s.raisedUsdc, s.targetUsdc)} to graduation</p>
        </div>
      )}
      <p className="mt-2 flex flex-wrap gap-1.5">
        <Chip>{coinPrice(s.priceUsdc)}</Chip>
        <Chip>{s.holders} holders</Chip>
        <Chip>{s.episodes} canon</Chip>
      </p>
      <p className="mt-3 flex items-center justify-between font-display text-[15px] uppercase text-kapow">
        Back {s.characterName} →
        <span className="flex items-center gap-1 font-mono text-[10px] normal-case text-mute">
          <ArcMark width={10} height={10} /> Arc
        </span>
      </p>
    </a>
  );
}
