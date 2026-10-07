"use client";

import { createEd25519SigningSession, createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError, type Ed25519SigningSession } from "@category-labs/mera";
import { bytesToHex, sha256, stringToBytes } from "viem";
import { roomMessage, type RoomAction } from "./protocol";

/**
 * The Writers' Room: one passkey, keys that are not a wallet (Mera "One Passkey, Many Keys").
 *
 * A single WebAuthn PRF evaluation under KOMA's own salt (`koma.writers-room.v1`, never Mera's default wallet salt)
 * gives 32 secret bytes. HKDF separates them into two keys with distinct `info` labels:
 *   - identity: an Ed25519 key, held in a Mera signing session. Its public key is the room id; it signs every
 *     request so the server knows which room is asking, without an account, an email or a wallet address.
 *   - drafts: an AES-256-GCM key (non-extractable CryptoKey) that encrypts each draft in the browser. AAD binds a
 *     ciphertext to its room and draft id. KOMA's server only ever stores ciphertext.
 * Nothing secret is persisted: the PRF bytes and the derived identity seed are zeroed right after derivation, the
 * session key is zeroed by `end()` on lock or expiry, and the AES key lives only in memory. The same passkey on
 * another device (synced by iCloud Keychain, Google Password Manager or 1Password) derives the same room.
 * Neither key ever signs a transaction or holds funds.
 */
export const ROOM_SALT = sha256(stringToBytes("koma.writers-room.v1"), "bytes");
const INFO_IDENTITY = "koma.writers-room.v1/identity";
const INFO_DRAFTS = "koma.writers-room.v1/drafts";
/** A room locks itself after this long; reopening takes one passkey prompt. */
export const SESSION_MS = 10 * 60_000;

export type Room = {
  id: `0x${string}`;
  expiresAt: number;
  sign: (action: RoomAction, extra?: string) => Promise<{ room: string; ts: number; sig: string }>;
  encrypt: (draftId: string, plaintext: string) => Promise<{ nonce: string; ciphertext: string }>;
  decrypt: (draftId: string, nonce: string, ciphertext: string) => Promise<string>;
  lock: () => void;
};

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hkdf(prf: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveBits", "deriveKey"]);
  const params = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(info) });
  const seed = new Uint8Array(await crypto.subtle.deriveBits(params(INFO_IDENTITY), base, 256));
  const aes = await crypto.subtle.deriveKey(params(INFO_DRAFTS), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { seed, aes };
}

function open(prf: Uint8Array<ArrayBuffer>): Promise<Room> {
  return hkdf(prf).then(({ seed, aes }) => {
    prf.fill(0);
    let session: Ed25519SigningSession | null = createEd25519SigningSession({ privateKey: seed });
    seed.fill(0);
    const id = bytesToHex(session.publicKey);
    const aad = (draftId: string) => new TextEncoder().encode(`${id}:${draftId}`);
    let key: CryptoKey | null = aes;
    const live = () => {
      if (!session || !key) throw new Error("The room is locked. Open it with your passkey.");
      return { session, key };
    };
    return {
      id,
      expiresAt: Date.now() + SESSION_MS,
      async sign(action, extra = "") {
        const ts = Math.floor(Date.now() / 1000);
        const sig = await live().session.signMessage(new TextEncoder().encode(roomMessage(action, id, ts, extra)));
        return { room: id, ts, sig: bytesToHex(sig) };
      },
      async encrypt(draftId, plaintext) {
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(draftId) }, live().key, new TextEncoder().encode(plaintext));
        return { nonce: b64(nonce), ciphertext: b64(new Uint8Array(ct)) };
      },
      async decrypt(draftId, nonce, ciphertext) {
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(nonce), additionalData: aad(draftId) }, live().key, unb64(ciphertext));
        return new TextDecoder().decode(pt);
      },
      lock() {
        session?.end();
        session = null;
        key = null;
      },
    };
  });
}

/** First visit: a new passkey for the room (one ceremony; some authenticators add a second prompt for PRF). */
export async function createRoom(): Promise<Room> {
  const r = await createPasskeyWithPrfOutput({
    rp: { id: location.hostname, name: "KOMA Writers' Room" },
    user: { name: "KOMA Writers' Room", displayName: "KOMA Writers' Room" },
    prfSalt: ROOM_SALT,
  });
  return open(r.prfOutput);
}

/** Any later visit, on any device with the passkey: one prompt rebuilds the same room. */
export async function openRoom(): Promise<Room> {
  const r = await getPasskeyPrfOutput({ rpId: location.hostname, prfSalt: ROOM_SALT });
  return open(r.prfOutput);
}

export function roomError(e: unknown): string {
  if (isMeraError(e)) {
    if (e.code === "PRF_UNAVAILABLE") return "This passkey provider can't derive keys (no WebAuthn PRF). Use iCloud Keychain, Google Password Manager or 1Password.";
    if (e.code === "PASSKEY_OPERATION_FAILED") return "The passkey prompt was cancelled or isn't available here.";
  }
  return e instanceof Error ? e.message : "Couldn't open the room.";
}
