import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes, isHex, stringToBytes } from "viem";
import { bodyHash, DRAFT_ID, MAX_CIPHERTEXT, MAX_DRAFTS, ROOM_SKEW_S, roomMessage, type RoomAction, type StoredDraft } from "@/lib/room/protocol";
import { db as base } from "./store";

/**
 * Writers' Room storage (see src/lib/room/keys.ts). A room is an Ed25519 public key derived from a passkey's PRF
 * output; KOMA stores only AES-GCM ciphertext under it and never sees a key, a plaintext, an email or a wallet.
 * Every request is signed by the room key over (action, room, time, body hash), within a 5-minute window.
 */
let ready = false;
function db() {
  const d = base();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS room_drafts (
      room TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (room, draft_id)
    )`);
    ready = true;
  }
  return d;
}

export { bodyHash };

export type Signed = { room: string; ts: number; sig: string };

/** Null when the request is properly signed by the room key, else the reason. */
export function checkSignature(action: RoomAction, s: Partial<Signed>, extra = "", now = Math.floor(Date.now() / 1000)): string | null {
  if (!isHex(s.room) || s.room.length !== 66) return "room must be a 32-byte Ed25519 public key";
  if (!isHex(s.sig) || s.sig.length !== 130) return "sig must be a 64-byte Ed25519 signature";
  if (!Number.isInteger(s.ts) || Math.abs(now - Number(s.ts)) > ROOM_SKEW_S) return "request expired; check your clock";
  try {
    const ok = ed25519.verify(hexToBytes(s.sig), stringToBytes(roomMessage(action, s.room, Number(s.ts), extra)), hexToBytes(s.room));
    return ok ? null : "signature doesn't match the room";
  } catch {
    return "signature doesn't match the room";
  }
}

export function listDrafts(room: string): StoredDraft[] {
  return (
    db().prepare("SELECT draft_id, nonce, ciphertext, updated_at FROM room_drafts WHERE room = ? ORDER BY updated_at DESC").all(room.toLowerCase()) as {
      draft_id: string; nonce: string; ciphertext: string; updated_at: number;
    }[]
  ).map((r) => ({ draftId: r.draft_id, nonce: r.nonce, ciphertext: r.ciphertext, updatedAt: r.updated_at }));
}

export function putDraft(room: string, d: { draftId: string; nonce: string; ciphertext: string }): string | null {
  if (!DRAFT_ID.test(d.draftId)) return "bad draft id";
  if (!/^[A-Za-z0-9_-]{16}$/.test(d.nonce)) return "nonce must be 12 bytes, base64url";
  if (!/^[A-Za-z0-9_-]+$/.test(d.ciphertext) || d.ciphertext.length > MAX_CIPHERTEXT) return "ciphertext too large or not base64url";
  const r = room.toLowerCase();
  const exists = db().prepare("SELECT 1 FROM room_drafts WHERE room = ? AND draft_id = ?").get(r, d.draftId);
  if (!exists && (db().prepare("SELECT COUNT(*) AS n FROM room_drafts WHERE room = ?").get(r) as { n: number }).n >= MAX_DRAFTS) return `a room holds at most ${MAX_DRAFTS} drafts`;
  db()
    .prepare(
      `INSERT INTO room_drafts (room, draft_id, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room, draft_id) DO UPDATE SET nonce = excluded.nonce, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
    )
    .run(r, d.draftId, d.nonce, d.ciphertext, Math.floor(Date.now() / 1000));
  return null;
}

export function deleteDraft(room: string, draftId: string) {
  db().prepare("DELETE FROM room_drafts WHERE room = ? AND draft_id = ?").run(room.toLowerCase(), draftId);
}
