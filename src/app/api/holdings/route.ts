import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { holdingsOf } from "@/lib/server/launchpad/queries";
import type { Addr } from "@/lib/launchpad/types";

export const dynamic = "force-dynamic";

/** GET /api/holdings?address=0x… → the series coins an address holds, from KOMA's index of the chain. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ error: "Send ?address=0x…" }, { status: 400 });
  if (!launchpad()) return NextResponse.json({ error: "The series launchpad is not configured on this server." }, { status: 503 });
  return NextResponse.json({ holdings: holdingsOf(address as Addr) }, { headers: { "Cache-Control": "no-store" } });
}
