import { NextResponse } from "next/server";
import { publicClient } from "@/lib/server/config";
import { recentSpeeds } from "@/lib/server/speed";

export const dynamic = "force-dynamic";

/** The chain head (block, its time, the measured block interval) and KOMA's recent confirmation times. */
export async function GET() {
  const head = await publicClient.getBlock().catch(() => null);
  let blockMs: number | null = null;
  if (head && head.number > BigInt(10)) {
    const past = await publicClient.getBlock({ blockNumber: head.number - BigInt(10) }).catch(() => null);
    // Block timestamps are whole seconds; over 10 blocks that's good to ~0.1 s.
    if (past) blockMs = Math.round((Number(head.timestamp - past.timestamp) * 1000) / 10);
  }
  const { count, medianMs } = recentSpeeds(100);
  return NextResponse.json(
    { block: head ? Number(head.number) : null, timestamp: head ? Number(head.timestamp) : null, blockMs, confirmations: count, medianMs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
