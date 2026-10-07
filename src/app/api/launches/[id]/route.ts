import { NextResponse, type NextRequest } from "next/server";
import { getLaunchJob } from "@/lib/server/launchpad/db";
import { seriesRow } from "@/lib/server/launchpad/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/launches/[id]">) {
  const job = getLaunchJob((await ctx.params).id);
  if (!job) return NextResponse.json({ error: "No such launch" }, { status: 404 });
  // `indexed`: the series page can be opened (the chain index trails the launch transaction by a block or two).
  const indexed = Boolean(job.seriesId && seriesRow(job.seriesId));
  return NextResponse.json({ ...job, nonce: undefined, indexed }, { headers: { "Cache-Control": "no-store" } });
}
