import { NextResponse, type NextRequest } from "next/server";
import { parseAbi } from "viem";
import { config, publicClient } from "@/lib/server/config";
import { listIssues } from "@/lib/server/store";

/** ERC-721 metadata for KomaIssues.tokenURI(id). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tokens/[id]">) {
  const tokenId = Number((await ctx.params).id);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) return NextResponse.json({ error: "Unknown token" }, { status: 404 });
  const c = (await listIssues()).find((i) => i.chain.tokenId === tokenId);
  if (!c) {
    if (!config.contract) return NextResponse.json({ error: "Metadata unavailable" }, { status: 503 });
    try {
      const issue = await publicClient.readContract({ address: config.contract,
        abi: parseAbi(["function issue(uint256) view returns ((bytes32 contentHash,bytes32 paymentTx,uint256 remixOf,uint64 mintedAt,uint16 pages))"]),
        functionName: "issue", args: [BigInt(tokenId)] });
      return NextResponse.json({ name: `KOMA #${tokenId}`, description: "Minted on Arc. Artwork for this issue has not been published to this host; the on-chain content hash and payment receipt remain verifiable.",
        external_url: `${config.publicUrl}/tx/${issue.paymentTx}`, content_hash: issue.contentHash, payment_tx: issue.paymentTx,
        attributes: [{ trait_type: "Pages", value: issue.pages, display_type: "number" }, { trait_type: "Artwork", value: "Not published to this host" }] });
    } catch {
      return NextResponse.json({ error: "Token metadata could not be read from Arc. Check the token ID or retry shortly." }, { status: 503 });
    }
  }
  const base = config.publicUrl;
  return NextResponse.json({
    name: `${c.title} · KOMA #${tokenId}`,
    description: c.logline,
    image: `${base}${c.cover}`,
    external_url: `${base}/c/${c.id}`,
    attributes: [
      { trait_type: "Genre", value: c.genre },
      { trait_type: "Style", value: c.style },
      { trait_type: "Pages", value: c.pageCount, display_type: "number" },
      { trait_type: "Paid (USDC)", value: c.chain.paidUsdc },
      ...(c.remixOf ? [{ trait_type: "Remix of", value: c.remixOf.title }] : []),
    ],
    content_hash: c.chain.contentHash,
    payment_tx: c.chain.paymentTx,
  });
}
