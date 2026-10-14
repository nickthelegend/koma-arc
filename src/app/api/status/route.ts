import { NextResponse } from "next/server";
import { config, publicClient } from "@/lib/server/config";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { budgetStatus } from "@/lib/server/budget";
import { falHealth } from "@/lib/server/fal-health";
import { aiSummary } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

/** What the studio needs to know before quoting: is the server ready, and on which chain. */
export async function GET() {
  const lp = launchpad();
  const relayerUsdc = config.account ? await publicClient.getBalance({ address: config.account.address }).then((b) => Number(b) / 1e18 /* native USDC, 18 decimals */).catch(() => null) : null;
  return NextResponse.json({
    ready: process.env.KOMA_HOSTED_READ_ONLY !== "1" && config.missing.length === 0,
    missing: process.env.KOMA_HOSTED_READ_ONLY === "1" ? ["Local studio server required for generation and settlement"] : config.missing,
    network: config.network.key,
    caip: config.network.caip,
    chainId: config.network.chain.id,
    usdc: config.network.usdc,
    faucetUrl: config.network.faucetUrl,
    publicUrl: config.publicUrl,
    payTo: config.payTo ?? null,
    contract: config.contract ?? null,
    facilitator: config.account?.address ?? null,
    relayerUsdc,
    budget: budgetStatus(),
    ai: { ...aiSummary(), ...(await falHealth()) },
    launchpad: lp ? { engine: lp.engine, addresses: lp } : null,
  });
}
