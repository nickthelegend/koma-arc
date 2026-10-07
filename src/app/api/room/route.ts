import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/client-ip";
import { limited } from "@/lib/server/rate-limit";
import { bodyHash, checkSignature, deleteDraft, listDrafts, putDraft, type Signed } from "@/lib/server/room";

export const dynamic = "force-dynamic";

/**
 * Writers' Room drafts, end-to-end encrypted to the writer's passkey (src/lib/room/keys.ts).
 *   GET    ?room=&ts=&sig=                               → { drafts: [{ draftId, nonce, ciphertext, updatedAt }] }
 *   PUT    { room, ts, sig, draftId, nonce, ciphertext }  → { ok }
 *   DELETE { room, ts, sig, draftId }                     → { ok }
 * Each request is signed by the room's Ed25519 key; the server can't read what it stores.
 */
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  if (limited(`room:${clientIp(req)}`, 60_000, 60)) return bad("Too many requests.", 429);
  const q = req.nextUrl.searchParams;
  const s = { room: q.get("room") ?? "", ts: Number(q.get("ts")), sig: q.get("sig") ?? "" };
  const why = checkSignature("list", s);
  if (why) return bad(why, 401);
  return NextResponse.json({ drafts: listDrafts(s.room) });
}

export async function PUT(req: NextRequest) {
  if (limited(`room:${clientIp(req)}`, 60_000, 60)) return bad("Too many requests.", 429);
  const b = (await req.json().catch(() => null)) as (Signed & { draftId: string; nonce: string; ciphertext: string }) | null;
  if (!b || typeof b.draftId !== "string" || typeof b.nonce !== "string" || typeof b.ciphertext !== "string") return bad("Send { room, ts, sig, draftId, nonce, ciphertext }.");
  const why = checkSignature("put", b, `${b.draftId}:${bodyHash(b.nonce, b.ciphertext)}`);
  if (why) return bad(why, 401);
  const err = putDraft(b.room, b);
  return err ? bad(err) : NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (limited(`room:${clientIp(req)}`, 60_000, 60)) return bad("Too many requests.", 429);
  const b = (await req.json().catch(() => null)) as (Signed & { draftId: string }) | null;
  if (!b || typeof b.draftId !== "string") return bad("Send { room, ts, sig, draftId }.");
  const why = checkSignature("delete", b, b.draftId);
  if (why) return bad(why, 401);
  deleteDraft(b.room, b.draftId);
  return NextResponse.json({ ok: true });
}
