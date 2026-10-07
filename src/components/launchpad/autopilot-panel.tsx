"use client";

import { useCallback, useEffect, useState } from "react";
import { txUrl } from "@/lib/explorer";
import { GASLESS_MIN_USDC } from "@/lib/network";
import { useWallet, walletErrorMessage } from "../wallet";

type Enrollment = { vote: boolean; buyUsd: number; policyId: string };
type Action = { kind: "vote" | "buy"; episode: number; detail: string; tx: string | null; at: number; error: string | null };
type Status = { mode: "privy" | "off"; signerId: string; maxBuyUsd: number; enrollment?: Enrollment | null; actions?: Action[] };

const BUY_OPTIONS = [0, GASLESS_MIN_USDC, 5, 10];

/** The text the backer signs; the server rebuilds it to check the signature (src/lib/server/autopilot). */
const message = (o: { address: string; seriesId: number; vote: boolean; buyUsd: number; issuedAt: number }) =>
  `KOMA autopilot\nwallet: ${o.address.toLowerCase()}\nseries: ${o.seriesId}\nvote: ${o.vote ? "yes" : "no"}\nauto-buy: $${o.buyUsd}\nissued: ${o.issuedAt}`;

/**
 * Backer autopilot: KOMA votes in each canon round with the backer's coins and/or buys a fixed amount when
 * an episode becomes canon. The authority is a Privy session signer on the backer's embedded wallet, limited
 * by a policy Privy enforces (canon votes on this series; AUSD only to this curve, capped per buy).
 */
export function AutopilotPanel({ seriesId, symbol }: { seriesId: number; symbol: string }) {
  const wallet = useWallet();
  const me = wallet.address;
  const [status, setStatus] = useState<Status | null>(null);
  const [vote, setVote] = useState(true);
  const [buyUsd, setBuyUsd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = me ? `?address=${me}&seriesId=${seriesId}` : "";
    const s = (await fetch(`/api/autopilot${q}`).then((r) => r.json()).catch(() => null)) as Status | null;
    setStatus(s);
    if (s?.enrollment) {
      setVote(s.enrollment.vote);
      setBuyUsd(s.enrollment.buyUsd);
    }
  }, [me, seriesId]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const enrolled = Boolean(status?.enrollment);
  const needsEmbedded = status?.mode === "privy" && !wallet.privy?.embedded;

  async function signed(o: { vote: boolean; buyUsd: number }) {
    const w = await wallet.walletClient();
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await w.signMessage({ account: w.account, message: message({ address: w.account.address, seriesId, ...o, issuedAt }) });
    return { address: w.account.address, seriesId, issuedAt, signature, ...o };
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...(await signed({ vote, buyUsd })), walletId: wallet.privy?.walletId ?? null };
      const res = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't turn the autopilot on.");
      // Privy: attach KOMA's session signer to the embedded wallet, limited by the policy just created.
      if (j.mode === "privy" && wallet.privy) await wallet.privy.addSigners(j.signerId, [j.enrollment.policyId]);
      await load();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const body = await signed({ vote: false, buyUsd: 0 });
      const res = await fetch("/api/autopilot", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't switch it off.");
      if (status?.mode === "privy" && wallet.privy) await wallet.privy.removeSigners();
      await load();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="autopilot-h" className="border border-rule bg-stock px-4 py-4 md:px-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="autopilot-h" className="font-display text-[22px] uppercase leading-none text-paper">
          Backer autopilot
        </h2>
        <span className="font-mono text-[11px] text-mute">
          {status?.mode === "privy" ? "Privy session signer + policy" : "not configured"}
        </span>
      </header>
      <p className="mt-2 text-[13px] leading-relaxed text-soft">
        Let KOMA vote in every canon round with your ${symbol}, and buy a little more each time an episode becomes canon. You sign once; a
        policy limits what can be signed for you: votes on this series, and AUSD only to this series&rsquo; curve, never more than your amount per buy.
      </p>

      {status?.mode === "off" ? (
        <p className="mt-3 text-[12.5px] text-mute">This server hasn&rsquo;t been given its Privy session signer yet, so the autopilot is off. Nothing is signed for anyone.</p>
      ) : !me ? (
        <button onClick={wallet.connect} className="mt-4 h-10 border border-paper/70 px-4 text-[13px] font-semibold text-paper hover:bg-paper hover:text-ink">
          Connect to set up the autopilot
        </button>
      ) : needsEmbedded ? (
        <p className="mt-3 text-[12.5px] text-mute">The autopilot runs on a Privy embedded wallet. Log in with email, Google or a passkey to use it.</p>
      ) : (
        <>
          <fieldset className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]" disabled={busy}>
            <label className="flex items-center gap-2 text-paper">
              <input type="checkbox" checked={vote} onChange={(e) => setVote(e.target.checked)} className="h-4 w-4 accent-[var(--kapow)]" />
              Vote for me each round
            </label>
            <span className="flex items-center gap-2 text-soft">
              Auto-buy per canon episode
              <span role="radiogroup" aria-label="Auto-buy amount" className="flex">
                {BUY_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={buyUsd === v}
                    onClick={() => setBuyUsd(v)}
                    className={`border border-rule px-2.5 py-1 font-mono text-[12px] ${buyUsd === v ? "bg-paper text-ink" : "text-soft hover:text-paper"}`}
                  >
                    {v === 0 ? "off" : `$${v}`}
                  </button>
                ))}
              </span>
            </span>
          </fieldset>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={turnOn} disabled={busy || (!vote && buyUsd === 0)} className="slant px-5 py-2.5 text-[16px] disabled:opacity-50">
              {busy ? "Confirm in your wallet…" : enrolled ? "Update autopilot" : "Turn on autopilot"}
            </button>
            {enrolled && (
              <button onClick={turnOff} disabled={busy} className="border border-rule px-4 text-[13px] text-soft hover:text-paper">
                Switch off
              </button>
            )}
          </div>
          {error && <p role="alert" className="mt-2 text-[12.5px] text-kapow">{error}</p>}
          {enrolled && (
            <p className="mt-3 text-[12px] text-mute">
              On: {status!.enrollment!.vote ? "voting each round" : "not voting"}
              {status!.enrollment!.buyUsd ? `, buying $${status!.enrollment!.buyUsd} per canon episode` : ""}.
            </p>
          )}
          {status?.actions && status.actions.length > 0 && (
            <ul className="mt-3 border-t border-rule pt-2 text-[12.5px]">
              {status.actions.map((a) => (
                <li key={`${a.kind}-${a.episode}`} className="flex flex-wrap items-baseline gap-x-2 py-1 text-soft">
                  <span className={`font-mono text-[11px] uppercase ${a.error ? "text-kapow" : "text-arb"}`}>{a.kind}</span>
                  <span>{a.error ? `${a.detail}: ${a.error}` : a.detail}</span>
                  {a.tx && (
                    <a href={txUrl(a.tx as `0x${string}`)} className="font-mono text-[11px] text-arb hover:underline">
                      tx
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
