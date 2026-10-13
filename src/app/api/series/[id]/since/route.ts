import { NextResponse, type NextRequest } from "next/server";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { changesSince } from "@/lib/server/launchpad/queries";
import { chainNow } from "@/lib/server/launchpad/chain-time";

export const dynamic = "force-dynamic";

/** GET /api/series/:id/since?t=<chain time> → what changed since then. Without t, just the chain's `now` to remember. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const t = Number(req.nextUrl.searchParams.get("t"));
  if (!launchpad() || !Number.isSafeInteger(id)) return NextResponse.json({ error: "no series" }, { status: 404 });
  if (!Number.isFinite(t) || t <= 0) return NextResponse.json({ now: await chainNow() }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(await changesSince(id, Math.floor(t)), { headers: { "Cache-Control": "no-store" } });
}
