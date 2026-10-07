"use client";

import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, sha256, stringToBytes } from "viem";
import { roomMessage, type RoomAction } from "./protocol";

/**
 * The Writers' Room: one passkey, keys that are not a wallet.
 *
 * A single WebAuthn PRF evaluation under KOMA's own salt (`koma.writers-room.v1`) gives 32 secret bytes. HKDF
 * separates them into two keys with distinct `info` labels:
 *   - identity: an Ed25519 key. Its public key is the room id; it signs every request so the server knows which
 *     room is asking, without an account, an email or a wallet address.
 *   - drafts: an AES-256-GCM key (non-extractable CryptoKey) that encrypts each draft in the browser. AAD binds a
 *     ciphertext to its room and draft id. KOMA's server only ever stores ciphertext.
 * Nothing secret is persisted: the PRF bytes are zeroed right after derivation, the identity seed is zeroed on
 * lock or expiry, and the AES key lives only in memory. The same passkey on another device (synced by iCloud
 * Keychain, Google Password Manager or 1Password) derives the same room. Neither key ever signs a transaction or
 * holds funds.
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

/** A failure the room UI explains in words. */
export class RoomError extends Error {
  constructor(
    readonly code: "PRF_UNAVAILABLE" | "PASSKEY_OPERATION_FAILED",
    message: string,
  ) {
    super(message);
  }
}

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
    let secret: Uint8Array | null = seed;
    const id = bytesToHex(ed25519.getPublicKey(seed));
    const aad = (draftId: string) => new TextEncoder().encode(`${id}:${draftId}`);
    let key: CryptoKey | null = aes;
    const live = () => {
      if (!secret || !key) throw new Error("The room is locked. Open it with your passkey.");
      return { secret, key };
    };
    return {
      id,
      expiresAt: Date.now() + SESSION_MS,
      async sign(action, extra = "") {
        const ts = Math.floor(Date.now() / 1000);
        const sig = ed25519.sign(new TextEncoder().encode(roomMessage(action, id, ts, extra)), live().secret);
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
        secret?.fill(0);
        secret = null;
        key = null;
      },
    };
  });
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const prfInputs = () => ({ prf: { eval: { first: ROOM_SALT } } }) as AuthenticationExtensionsClientInputs;

function prfOutput(cred: Credential | null): Uint8Array<ArrayBuffer> | null {
  const ext = (cred as PublicKeyCredential | null)?.getClientExtensionResults() as PrfResults | undefined;
  const first = ext?.prf?.results?.first;
  return first ? new Uint8Array(first.slice(0)) : null;
}

async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof RoomError) throw e;
    throw new RoomError("PASSKEY_OPERATION_FAILED", (e as Error)?.message ?? "Passkey operation failed.");
  }
}

/** Evaluates PRF on an existing passkey for this site (any synced copy works). */
async function evaluate(allow?: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  const cred = await ceremony(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: "required",
        allowCredentials: allow ? [{ type: "public-key", id: allow }] : [],
        extensions: prfInputs(),
      },
    }),
  );
  const out = prfOutput(cred);
  if (!out) throw new RoomError("PRF_UNAVAILABLE", "This passkey can't derive keys (no WebAuthn PRF).");
  return out;
}

/** First visit: a new passkey for the room (one ceremony; some authenticators add a second prompt for PRF). */
export async function createRoom(): Promise<Room> {
  const cred = (await ceremony(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: "KOMA Writers' Room" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "KOMA Writers' Room", displayName: "KOMA Writers' Room" },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: prfInputs(),
      },
    }),
  )) as PublicKeyCredential | null;
  if (!cred) throw new RoomError("PASSKEY_OPERATION_FAILED", "No passkey was created.");
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf?.enabled === false) throw new RoomError("PRF_UNAVAILABLE", "This passkey provider doesn't support WebAuthn PRF.");
  // Some authenticators return PRF output at creation; the rest need one assertion with the new credential.
  return open(prfOutput(cred) ?? (await evaluate(cred.rawId)));
}

/** Any later visit, on any device with the passkey: one prompt rebuilds the same room. */
export async function openRoom(): Promise<Room> {
  return open(await evaluate());
}

export function roomError(e: unknown): string {
  if (e instanceof RoomError) {
    if (e.code === "PRF_UNAVAILABLE") return "This passkey provider can't derive keys (no WebAuthn PRF). Use iCloud Keychain, Google Password Manager or 1Password.";
    if (e.code === "PASSKEY_OPERATION_FAILED") return "The passkey prompt was cancelled or isn't available here.";
  }
  return e instanceof Error ? e.message : "Couldn't open the room.";
}
