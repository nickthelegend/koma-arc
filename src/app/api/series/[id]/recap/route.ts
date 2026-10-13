import { NextResponse } from "next/server";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { recapFor } from "@/lib/server/launchpad/recap";

export const dynamic = "force-dynamic";

/** GET /api/series/:id/recap → { recap: { episode, text, model } | null }. Written once per canon episode, then cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!launchpad() || !Number.isSafeInteger(id)) return NextResponse.json({ recap: null });
  try {
    return NextResponse.json({ recap: await recapFor(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // No model, over budget, or the model failed: the page simply shows no recap.
    return NextResponse.json({ recap: null, error: (e as Error).message }, { status: 200 });
  }
}
