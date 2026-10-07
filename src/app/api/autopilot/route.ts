import { NextResponse, type NextRequest } from "next/server";
import { isAddress, isHex } from "viem";
import { actionsFor, enroll, getEnrollment, MAX_AUTOBUY_USD, unenroll } from "@/lib/server/autopilot";
import { signerId, signerMode } from "@/lib/server/autopilot/signer";
import { clientIp } from "@/lib/server/client-ip";
import { limited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/autopilot?address=&seriesId= — the backer's autopilot for a series and what it has done. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const seriesId = Number(req.nextUrl.searchParams.get("seriesId"));
  const base = { mode: signerMode(), signerId: signerId(), maxBuyUsd: MAX_AUTOBUY_USD };
  if (!isAddress(address) || !Number.isInteger(seriesId)) return NextResponse.json(base);
  return NextResponse.json({ ...base, enrollment: getEnrollment(address, seriesId), actions: actionsFor(address, seriesId) });
}

/** POST { address, seriesId, vote, buyUsd, walletId?, issuedAt, signature } — turn it on or change it. */
export async function POST(req: NextRequest) {
  if (limited(`autopilot:${clientIp(req)}`, 10 * 60_000, 30)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isAddress(String(b.address)) || !Number.isInteger(b.seriesId) || typeof b.vote !== "boolean" || typeof b.buyUsd !== "number" || !isHex(b.signature) || typeof b.issuedAt !== "number") {
    return NextResponse.json({ error: "Send { address, seriesId, vote, buyUsd, issuedAt, signature, walletId? }." }, { status: 400 });
  }
  const r = await enroll({
    address: b.address as `0x${string}`,
    seriesId: b.seriesId as number,
    vote: b.vote,
    buyUsd: b.buyUsd,
    walletId: typeof b.walletId === "string" ? b.walletId : null,
    issuedAt: b.issuedAt,
    signature: b.signature as `0x${string}`,
  }).catch((e) => ({ ok: false as const, status: 502, error: (e as Error).message }));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}

/** DELETE { address, seriesId, issuedAt, signature } — switch it off. */
export async function DELETE(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isAddress(String(b.address)) || !Number.isInteger(b.seriesId) || !isHex(b.signature) || typeof b.issuedAt !== "number") {
    return NextResponse.json({ error: "Send { address, seriesId, issuedAt, signature }." }, { status: 400 });
  }
  const r = await unenroll({ address: b.address as `0x${string}`, seriesId: b.seriesId as number, issuedAt: b.issuedAt, signature: b.signature as `0x${string}` });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
