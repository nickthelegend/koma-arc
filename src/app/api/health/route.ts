import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Process liveness only: paid pipeline and funded interop have independent readiness gates. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "koma-arc" }, { headers: { "Cache-Control": "no-store" } });
}
