import { NextResponse, type NextRequest } from "next/server";
import { isHash } from "viem";
import { ethereumCostUsd, speedOf } from "@/lib/server/speed";

export const dynamic = "force-dynamic";

/** One transaction's Arc speed receipt. `pending` until its receipt has been seen (200 either way, for polling). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/speed/[tx]">) {
  const tx = (await ctx.params).tx;
  if (!isHash(tx)) return NextResponse.json({ error: "Not a transaction hash." }, { status: 400 });
  const s = speedOf(tx);
  if (!s) return NextResponse.json({ tx, pending: true }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ...s, pending: false, ethereum: await ethereumCostUsd(s.gasUsed) }, { headers: { "Cache-Control": "no-store" } });
}
