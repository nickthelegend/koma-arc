import Link from "next/link";
import type { FamilyNode } from "@/lib/server/launchpad/queries";
import { usdAmount } from "@/lib/format";
import { IconRemix } from "@/components/icons";
import { Chip } from "@/components/ui";

/**
 * A series' remix family as a tree: every remix branches from its parent, and each node shows the royalties that
 * really flowed up (what its trades sent to its ancestors, and what its character earned from those below it).
 */
export function FamilyTree({ nodes, current }: { nodes: FamilyNode[]; current: number }) {
  const total = nodes.reduce((s, n) => s + n.sentUpUsdc, 0);
  return (
    <figure data-family-tree={nodes.length} className="mt-3">
      <ol>
        {nodes.map((n) => {
          const me = n.id === current;
          return (
            <li key={n.id} data-family-node={n.id} data-current={me || undefined} style={{ paddingLeft: `${n.depth * 24}px` }} className="relative py-1">
              {n.depth > 0 && <span aria-hidden className="absolute top-0 h-1/2 w-3.5 border-b border-l border-rule" style={{ left: `${(n.depth - 1) * 24 + 8}px` }} />}
              <Link
                href={`/s/${n.id}`}
                aria-current={me ? "page" : undefined}
                className={`relative flex items-center gap-2.5 border px-2 py-1.5 ${me ? "border-kapow bg-kapow/10" : "border-rule bg-ink hover:border-paper"}`}
              >
                {n.sheetUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.sheetUrl} alt="" className="h-9 w-9 shrink-0 border border-rule object-cover" />
                ) : (
                  <span className="halftone h-9 w-9 shrink-0 border border-rule text-kapow/40" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-paper">
                    {n.depth > 0 && <IconRemix width={12} height={12} className="shrink-0 text-mute" />}
                    <span className="truncate">{n.name}</span>
                    <span className="font-mono text-[11px] font-normal text-kapow">${n.symbol.trim()}</span>
                  </span>
                  <span className="block font-mono text-[11px] text-mute">{n.depth === 0 ? "original" : `gen ${n.depth}`}</span>
                </span>
                {n.fromBelowUsdc > 0 && (
                  <span className="shrink-0 font-mono text-[12px] text-arb" title={`Earned from remixes below it; its own trades sent ${usdAmount(n.sentUpUsdc)} up`}>
                    +{usdAmount(n.fromBelowUsdc)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
      <figcaption className="mt-2 flex flex-wrap gap-1.5">
        <Chip>{nodes.length} series</Chip>
        {total > 0 && <Chip tone="arb">{usdAmount(total)} royalties up the tree</Chip>}
      </figcaption>
    </figure>
  );
}
