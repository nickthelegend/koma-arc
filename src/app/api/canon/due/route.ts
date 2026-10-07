import { NextResponse } from "next/server";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { chainNow } from "@/lib/server/launchpad/chain-time";
import { creSettles, dueSlots } from "@/lib/server/launchpad/relay";

export const dynamic = "force-dynamic";

/**
 * What the Chainlink CRE workflow (cre/koma-canon) settles: canon slots whose voting window has closed, each with
 * the signed votes KOMA collected. Nothing here is trusted by the workflow: it checks every slot on chain,
 * verifies each EIP-712 signature against the registry's domain and re-reads each voter's weight at the
 * snapshot. The list is deterministic (sorted, no timestamps) so every DON node fetches identical bytes.
 */
export async function GET() {
  const a = launchpad();
  if (!a) return NextResponse.json({ error: "launchpad not deployed" }, { status: 503 });
  const slots = dueSlots(await chainNow());
  return NextResponse.json({
    chainId: a.chainId,
    canonRegistry: a.canonRegistry.toLowerCase(),
    canonSettler: a.canonSettler?.toLowerCase() ?? null,
    creSettles: creSettles(),
    slots,
  });
}
