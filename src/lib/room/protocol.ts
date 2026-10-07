import { sha256, stringToBytes } from "viem";

/** What a room key signs, shared by the browser (src/lib/room/keys.ts) and the server (src/lib/server/room.ts). */
export type RoomAction = "list" | "put" | "delete";

/** `extra` binds the signature to the request body: the draft id and a hash of the ciphertext for `put`. */
export const roomMessage = (action: RoomAction, room: string, ts: number, extra = "") => `KOMA writers-room v1\n${action}\n${room.toLowerCase()}\n${ts}\n${extra}`;

/** A request older or newer than this is refused (replay window). */
export const ROOM_SKEW_S = 300;
export const MAX_DRAFTS = 100;
export const MAX_CIPHERTEXT = 96 * 1024;
export const DRAFT_ID = /^[a-z0-9-]{8,40}$/;

/** A pitch handed from the Writers' Room to the studio, in this tab only (sessionStorage), never in a URL. */
export const HANDOFF_KEY = "koma:room-handoff";

export type StoredDraft = { draftId: string; nonce: string; ciphertext: string; updatedAt: number };

/** Binds a `put` signature to its body. */
export const bodyHash = (nonce: string, ciphertext: string) => sha256(stringToBytes(`${nonce}.${ciphertext}`));
