import { NextResponse, type NextRequest } from "next/server";
import { formatUnits, isAddress, isHex } from "viem";
import { clientIp } from "@/lib/server/client-ip";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { recordVote } from "@/lib/server/launchpad/canon";
import { limited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/canon/[series]/vote { episode, issueId, voter, signature }
 * A free, signed vote. Weight is the voter's coin balance at the slot's
 * snapshot, read from the chain. Voting again before the window closes
 * replaces the earlier vote.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/canon/[series]/vote">) {
  const a = launchpad();
  if (!a) return NextResponse.json({ error: "The launchpad isn't deployed on this network yet." }, { status: 503 });
  if (limited(`vote:${clientIp(req)}`, 10 * 60_000, 60)) return NextResponse.json({ error: "Too many votes from here." }, { status: 429 });
  const seriesId = Number((await ctx.params).series);
  const b = (await req.json().catch(() => null)) as { episode?: number; issueId?: number; voter?: string; signature?: string } | null;
  const episode = Number(b?.episode);
  const issueId = Number(b?.issueId);
  if (!Number.isInteger(episode) || !Number.isInteger(issueId) || !isAddress(String(b?.voter)) || !isHex(b?.signature)) {
    return NextResponse.json({ error: "Send { episode, issueId, voter, signature }." }, { status: 400 });
  }
  const r = await recordVote(seriesId, episode, issueId, b!.voter as `0x${string}`, b!.signature as `0x${string}`);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const weight = r.weight;
  return NextResponse.json({ ok: true, weight: formatUnits(weight, 18) });
}
