"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { bodyHash, HANDOFF_KEY, type StoredDraft } from "@/lib/room/protocol";
import { createRoom, openRoom, roomError, type Room } from "@/lib/room/keys";
import { short } from "@/lib/format";

type Draft = { draftId: string; title: string; pitch: string; notes: string; updatedAt: number };

const newId = () => crypto.randomUUID().toLowerCase();
const blank = (): Draft => ({ draftId: newId(), title: "", pitch: "", notes: "", updatedAt: 0 });

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Writers' Room: unpublished pitches and story notes, end-to-end encrypted to a passkey. One passkey prompt opens
 * the room on any device; KOMA's server stores ciphertext under a room id that isn't linked to any wallet.
 */
export function WritersRoom() {
  const [room, setRoom] = useState<Room | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [current, setCurrent] = useState<Draft>(blank);
  const [busy, setBusy] = useState<null | "open" | "create" | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const roomRef = useRef<Room | null>(null);

  const lock = useCallback(() => {
    roomRef.current?.lock();
    roomRef.current = null;
    setRoom(null);
    setDrafts([]);
    setCurrent(blank());
    setSaved(null);
  }, []);

  // Session expiry: the keys are zeroed when the time is up, and when the page goes away.
  useEffect(() => {
    if (!room) return;
    const tick = () => {
      const ms = room.expiresAt - Date.now();
      if (ms <= 0) lock();
      else setLeft(ms);
    };
    const t = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [room, lock]);
  useEffect(() => {
    const away = () => roomRef.current?.lock();
    window.addEventListener("pagehide", away);
    return () => window.removeEventListener("pagehide", away);
  }, []);

  async function load(r: Room) {
    const s = await r.sign("list");
    const res = await fetch(`/api/room?room=${s.room}&ts=${s.ts}&sig=${s.sig}`, { cache: "no-store" });
    const j = (await res.json()) as { drafts?: StoredDraft[]; error?: string };
    if (!res.ok) throw new Error(j.error ?? "Couldn't load the room.");
    const out: Draft[] = [];
    for (const d of j.drafts ?? []) {
      try {
        const body = JSON.parse(await r.decrypt(d.draftId, d.nonce, d.ciphertext)) as Omit<Draft, "draftId" | "updatedAt">;
        out.push({ ...body, draftId: d.draftId, updatedAt: d.updatedAt });
      } catch {
        // A ciphertext that doesn't open under this passkey (tampered, or another room's) is skipped.
      }
    }
    setDrafts(out);
    setCurrent(out[0] ?? blank());
  }

  async function enter(kind: "open" | "create") {
    setBusy(kind);
    setError(null);
    try {
      const r = kind === "create" ? await createRoom() : await openRoom();
      roomRef.current = r;
      // Load (and decrypt) the drafts before showing the editor, so nothing typed is overwritten by the load.
      await load(r);
      setRoom(r);
      setLeft(r.expiresAt - Date.now());
    } catch (e) {
      roomRef.current?.lock();
      roomRef.current = null;
      setError(roomError(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const r = roomRef.current;
    if (!r) return;
    setBusy("save");
    setError(null);
    try {
      const { draftId, title, pitch, notes } = current;
      const { nonce, ciphertext } = await r.encrypt(draftId, JSON.stringify({ title, pitch, notes }));
      const s = await r.sign("put", `${draftId}:${bodyHash(nonce, ciphertext)}`);
      const res = await fetch("/api/room", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, draftId, nonce, ciphertext }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Couldn't save.");
      const now = Math.floor(Date.now() / 1000);
      const next = { ...current, updatedAt: now };
      setCurrent(next);
      setDrafts((ds) => [next, ...ds.filter((d) => d.draftId !== draftId)]);
      setSaved(Date.now());
    } catch (e) {
      setError(roomError(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const r = roomRef.current;
    if (!r || !current.updatedAt) return;
    setBusy("delete");
    try {
      const s = await r.sign("delete", current.draftId);
      await fetch("/api/room", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, draftId: current.draftId }) });
      const rest = drafts.filter((d) => d.draftId !== current.draftId);
      setDrafts(rest);
      setCurrent(rest[0] ?? blank());
    } catch (e) {
      setError(roomError(e));
    } finally {
      setBusy(null);
    }
  }

  function toStudio() {
    try {
      sessionStorage.setItem(HANDOFF_KEY, [current.title, current.pitch].filter(Boolean).join(": "));
    } catch {
      // Storage blocked: the studio just opens empty.
    }
  }

  if (!room) {
    return (
      <section aria-labelledby="room-lock-h" className="border border-rule bg-stock p-5 md:p-7">
        <h2 id="room-lock-h" className="font-display text-[24px] uppercase leading-none text-paper">
          Your room is locked
        </h2>
        <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-soft">
          One passkey prompt opens it on this device or any other where the passkey is synced (iCloud Keychain, Google Password Manager,
          1Password). No account, email or wallet.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => enter("open")} disabled={busy !== null} className="slant h-11 px-6 text-[17px] disabled:opacity-50">
            {busy === "open" ? "Waiting for your passkey…" : "Open with passkey"}
          </button>
          <button
            onClick={() => enter("create")}
            disabled={busy !== null}
            className="h-11 border border-paper/70 px-5 text-[13.5px] font-semibold text-paper hover:bg-paper hover:text-ink disabled:opacity-50"
          >
            {busy === "create" ? "Creating your passkey…" : "First time? Create a room passkey"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-kapow">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="room-h" className="border border-rule bg-stock">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 md:px-5">
        <div>
          <h2 id="room-h" className="font-display text-[20px] uppercase leading-none text-paper">
            Room <span className="font-mono text-[13px] normal-case text-arb" title={room.id}>{short(room.id, 6, 4)}</span>
          </h2>
          <p className="mt-1 text-[12px] text-mute">Encrypted to your passkey · locks in {clock(left)}</p>
        </div>
        <button onClick={lock} className="border border-rule px-3 py-1.5 text-[12.5px] text-soft hover:text-paper">
          Lock now
        </button>
      </header>

      <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Drafts" className="border-b border-rule p-3 md:border-b-0 md:border-r">
          <button onClick={() => setCurrent(blank())} className="mb-2 w-full border border-dashed border-rule px-3 py-2 text-left text-[13px] text-soft hover:text-paper">
            + New draft
          </button>
          {drafts.length === 0 ? (
            <p className="px-1 text-[12.5px] text-mute">No drafts yet.</p>
          ) : (
            <ul>
              {drafts.map((d) => (
                <li key={d.draftId}>
                  <button
                    onClick={() => setCurrent(d)}
                    aria-current={d.draftId === current.draftId ? "true" : undefined}
                    className={`w-full truncate px-2 py-1.5 text-left text-[13px] ${d.draftId === current.draftId ? "bg-paper text-ink" : "text-soft hover:text-paper"}`}
                  >
                    {d.title || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <form
          className="flex flex-col gap-3 p-4 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="text-[12px] text-mute">
            Title
            <input
              value={current.title}
              onChange={(e) => setCurrent({ ...current, title: e.target.value.slice(0, 120) })}
              placeholder="Rust Bucket Riot, episode 3"
              className="mt-1 block h-10 w-full border border-rule bg-transparent px-3 text-[14px] text-paper placeholder:text-mute focus:border-soft focus:outline-none"
            />
          </label>
          <label className="text-[12px] text-mute">
            Pitch
            <textarea
              value={current.pitch}
              onChange={(e) => setCurrent({ ...current, pitch: e.target.value.slice(0, 600) })}
              rows={4}
              placeholder="What happens in this issue?"
              className="mt-1 block w-full border border-rule bg-transparent px-3 py-2 text-[14px] leading-relaxed text-paper placeholder:text-mute focus:border-soft focus:outline-none"
            />
          </label>
          <label className="text-[12px] text-mute">
            Notes, twists, the ending nobody should see yet
            <textarea
              value={current.notes}
              onChange={(e) => setCurrent({ ...current, notes: e.target.value.slice(0, 20_000) })}
              rows={8}
              className="mt-1 block w-full border border-rule bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-paper focus:border-soft focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy !== null || (!current.title && !current.pitch && !current.notes)} className="slant h-10 px-5 text-[15px] disabled:opacity-50">
              {busy === "save" ? "Encrypting…" : "Save encrypted"}
            </button>
            {current.pitch.trim().length >= 12 && (
              <Link href="/create" onClick={toStudio} className="text-[13px] text-soft underline decoration-rule underline-offset-4 hover:text-paper">
                Take the pitch to the studio →
              </Link>
            )}
            {current.updatedAt > 0 && (
              <button type="button" onClick={remove} disabled={busy !== null} className="ml-auto text-[12.5px] text-mute hover:text-kapow">
                Delete draft
              </button>
            )}
          </div>
          {saved && <p className="text-[12px] text-arb">Saved. KOMA holds only the ciphertext.</p>}
          {error && (
            <p role="alert" className="text-[13px] text-kapow">
              {error}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
