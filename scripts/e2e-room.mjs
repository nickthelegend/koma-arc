// Writers' Room (Mera "One Passkey, Many Keys") end to end in headless Chromium with a virtual WebAuthn
// authenticator that supports PRF: create a room passkey, save an encrypted draft, check the server only holds
// ciphertext under a room id unrelated to any wallet, wipe the browser and reopen with the passkey (the stateless
// test), carry the passkey to a fresh browser profile (cross-device), and hand the pitch to the studio.
//   node scripts/e2e-room.mjs        (app on :4320)
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const SECRET = `The mayor was the kaiju all along ${Date.now()}`;
const TITLE = `Episode 4 twist ${Date.now() % 10000}`;

const browser = await chromium.launch();

/** A browser profile with its own virtual platform authenticator (user-verifying, resident keys, PRF). */
async function device() {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  return { context, page, cdp, authenticatorId, errors };
}

async function openRoom(page, kind) {
  await page.goto(`${BASE}/room`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: kind === "create" ? /Create a room passkey/ : /Open with passkey/ }).click();
  const opened = page.getByText(/locks in/);
  const failed = page.locator("section p[role=alert]"); // not Next's route announcer (also role=alert)
  await opened.or(failed).first().waitFor({ timeout: 20_000 });
  if (await failed.isVisible()) return `error: ${await failed.innerText()}`;
  return (await page.locator("#room-h span").getAttribute("title")) ?? "";
}

// R1: a new room passkey; one draft saved encrypted.
const A = await device();
const roomId = await openRoom(A.page, "create");
await A.page.getByLabel("Title").fill(TITLE);
await A.page.getByLabel("Pitch").fill("A kaiju runs for mayor and the city has to decide whether it is canon.");
await A.page.getByLabel(/Notes/).fill(SECRET);
await A.page.getByRole("button", { name: "Save encrypted" }).click();
await A.page.getByText("Saved. KOMA holds only the ciphertext.").waitFor({ timeout: 10_000 });
check("R1", "a room passkey (WebAuthn PRF via Mera) opens a room and saves an encrypted draft", /^0x[0-9a-f]{64}$/.test(roomId), `room ${roomId.slice(0, 14)}…`);

// R2: the server has ciphertext only, under an Ed25519 room id, not a wallet address.
const db = new DatabaseSync(process.env.KOMA_DB ?? ".data/koma.db", { readOnly: true });
const rows = db.prepare("SELECT * FROM room_drafts WHERE room = ?").all(roomId.toLowerCase());
const raw = JSON.stringify(rows);
check("R2", "KOMA stores only ciphertext: no title, pitch or notes in its database", rows.length === 1 && !raw.includes("kaiju") && !raw.includes(TITLE) && !raw.includes("mayor"), `${rows.length} row, ${rows[0]?.ciphertext.length ?? 0} b64 chars`);

// R3: requests must be signed by the room key.
const forged = await fetch(`${BASE}/api/room?room=${roomId}&ts=${Math.floor(Date.now() / 1000)}&sig=0x${"11".repeat(64)}`);
const tamper = await fetch(`${BASE}/api/room`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: roomId, ts: Math.floor(Date.now() / 1000), sig: `0x${"22".repeat(64)}`, draftId: rows[0].draft_id, nonce: rows[0].nonce, ciphertext: "AAAA" }) });
check("R3", "unsigned or forged requests are refused (401)", forged.status === 401 && tamper.status === 401, `${forged.status} ${tamper.status}`);

// R4: lock, then the stateless test: wipe every bit of browser storage, reload, open with the passkey.
await A.page.getByRole("button", { name: "Lock now" }).click();
await A.page.getByText("Your room is locked").waitFor();
await A.context.clearCookies();
await A.page.evaluate(async () => {
  localStorage.clear();
  sessionStorage.clear();
  for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
});
const again = await openRoom(A.page, "open");
await A.page.getByRole("button", { name: TITLE }).click();
const notesBack = await A.page.getByLabel(/Notes/).inputValue();
check("R4", "stateless: storage wiped, one passkey prompt rebuilds the same room and decrypts the draft", again === roomId && notesBack === SECRET, again === roomId ? "same room id" : `got ${again}`);

// R5: cross-device: the same passkey (as a synced credential would be) in a brand-new browser profile.
const { credentials } = await A.cdp.send("WebAuthn.getCredentials", { authenticatorId: A.authenticatorId });
const B = await device();
for (const c of credentials) await B.cdp.send("WebAuthn.addCredential", { authenticatorId: B.authenticatorId, credential: c });
const other = await openRoom(B.page, "open");
let crossNotes = "";
if (other === roomId) {
  await B.page.getByRole("button", { name: TITLE }).click();
  crossNotes = await B.page.getByLabel(/Notes/).inputValue();
}
if (other.includes("no WebAuthn PRF")) {
  // Chrome's virtual authenticator exports a credential without its PRF (hmac-secret) seed, so a copy can't
  // evaluate PRF. A real synced passkey carries it; that check needs two real devices (see docs/SPONSOR-GAP.md).
  console.log("SKIP R5 cross-device with a copied virtual credential — CDP doesn't export the PRF seed; verify on two real devices");
} else {
  check("R5", "cross-device: the passkey on a fresh profile opens the same room and reads the draft", other === roomId && crossNotes === SECRET, other === roomId ? "same room, draft decrypted" : other.slice(0, 160));
}

// R6: a different passkey is a different, empty room (rooms are per passkey, unlinkable).
const C = await device();
const third = await openRoom(C.page, "create");
const cDrafts = await C.page.getByRole("navigation", { name: "Drafts" }).getByRole("listitem").count();
check("R6", "another passkey gets another, empty room", third !== roomId && cDrafts === 0, `${third.slice(0, 12)}…`);

// R7: the pitch goes to the studio in-tab (sessionStorage), not through the URL.
await A.page.getByRole("link", { name: /Take the pitch to the studio/ }).click();
await A.page.waitForURL(/\/create$/);
const box = A.page.locator("textarea").first();
await box.waitFor();
await A.page.waitForTimeout(500);
const studioText = await box.inputValue();
check("R7", "\"Take the pitch to the studio\" fills the studio input without putting it in the URL", studioText.includes("kaiju runs for mayor") && !A.page.url().includes("kaiju"), A.page.url().replace(BASE, ""));

// R8: a clean console on every device.
const roomErrors = [...A.errors, ...B.errors, ...C.errors].filter((e) => !/favicon|Download the React DevTools/.test(e));
check("R8", "no console errors across the three devices", roomErrors.length === 0, roomErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
