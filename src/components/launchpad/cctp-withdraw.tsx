"use client";

import { useEffect, useState } from "react";
import { formatUnits, isAddress, type Hex } from "viem";
import { bridgeCharacterUsdc, cctpQuote, cctpStatus, landed, type CctpQuote, type CctpStatus } from "@/lib/launchpad/client";
import type { Addr } from "@/lib/launchpad/types";
import { txUrl } from "@/lib/explorer";
import { short } from "@/lib/format";
import { KOMA } from "@/lib/network";
import { useWallet, walletErrorMessage } from "../wallet";

type Phase =
  | { step: "idle" }
  | { step: "signing" }
  | { step: "burning"; tx: Hex }
  | { step: "tracking"; tx: Hex; status: CctpStatus | null }
  | { step: "error"; message: string; tx?: Hex };

const fmt = (raw: bigint) => Number(formatUnits(raw, 6)).toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * A character's earnings, out to another chain over Circle's CCTP V2. The owner signs one Arc transaction (the
 * character's ERC-6551 wallet approves and burns in a batch); Circle's Forwarding Service mints on the destination.
 */
export function CctpWithdraw({ account, balance, onDone }: { account: Addr; balance: bigint; onDone: () => void }) {
  const wallet = useWallet();
  const destinations = KOMA.cctpDestinations;
  const [domain, setDomain] = useState<number>(destinations[0].domain);
  const [recipient, setRecipient] = useState("");
  // Keyed by destination and amount, so a stale answer is never shown for a new choice.
  const [quoted, setQuoted] = useState<{ key: string; quote?: CctpQuote; error?: string } | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const dest = destinations.find((d) => d.domain === domain) ?? destinations[0];
  const to = (recipient || wallet.address || "") as Addr;

  const quoteKey = `${domain}:${balance}`;
  useEffect(() => {
    let live = true;
    cctpQuote(domain, balance).then(
      (quote) => live && setQuoted({ key: `${domain}:${balance}`, quote }),
      (e: Error) => live && setQuoted({ key: `${domain}:${balance}`, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [domain, balance]);
  const current = quoted?.key === quoteKey ? quoted : null;
  const quote = current?.quote ?? null;
  const quoteError = current?.error ?? null;

  // Poll Circle until the destination mint lands (or the attestation says it's complete without forwarding info).
  const trackingTx = phase.step === "tracking" ? phase.tx : null;
  const doneForwarding = phase.step === "tracking" && Boolean(phase.status?.forwardTxHash);
  useEffect(() => {
    if (!trackingTx || doneForwarding) return;
    let live = true;
    const tick = async () => {
      const status = await cctpStatus(trackingTx).catch(() => null);
      if (live) setPhase({ step: "tracking", tx: trackingTx, status });
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [trackingTx, doneForwarding]);

  const receive = quote && balance > quote.maxFee ? balance - quote.maxFee : BigInt(0);
  const busy = phase.step === "signing" || phase.step === "burning";
  const canSend = Boolean(quote && receive > BigInt(0) && isAddress(to) && !busy);

  async function send() {
    if (!quote || !canSend) return;
    setPhase({ step: "signing" });
    try {
      const w = await wallet.walletClient();
      const fresh = await cctpQuote(domain, balance);
      const tx = await bridgeCharacterUsdc(w, { account, amount: balance, destDomain: domain, recipient: to, maxFee: fresh.maxFee });
      setPhase({ step: "burning", tx });
      await landed(tx);
      setPhase({ step: "tracking", tx, status: null });
      onDone();
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "";
      setPhase({ step: "error", message: /reject|denied/i.test(msg) ? walletErrorMessage(e) : msg.length > 200 ? `${msg.slice(0, 200)}…` : msg });
    }
  }

  const status = phase.step === "tracking" ? phase.status : null;
  return (
    <div className="mt-4 border-t border-arb/20 pt-4">
      <p className="font-display text-[15px] uppercase leading-tight text-paper">Or send it to another chain</p>
      <p className="mt-1 text-[12px] leading-snug text-mute">
        Circle&rsquo;s CCTP burns the USDC on Arc and mints it on the other side. You sign once here; Circle&rsquo;s Forwarding Service
        pays the gas there.
      </p>
      <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-[12px] text-soft">
          To
          <select value={domain} onChange={(e) => setDomain(Number(e.target.value))} disabled={busy} className="h-9 border border-rule bg-ink px-2 text-[13px] text-paper">
            {destinations.map((d) => (
              <option key={d.domain} value={d.domain}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-soft">
          Recipient on {dest.name}
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder={wallet.address ?? "0x…"}
            disabled={busy}
            className="h-9 border border-rule bg-ink px-2 font-mono text-[12px] text-paper placeholder:text-mute"
          />
        </label>
      </div>
      <p className="mt-2 font-mono text-[11.5px] text-mute">
        {quoteError
          ? quoteError
          : !quote
            ? "Asking Circle for the fee…"
            : receive > BigInt(0)
              ? `${fmt(balance)} burned · ≤${fmt(quote.maxFee)} fee · ≥${fmt(receive)} USDC arrives`
              : `Circle's fee to ${dest.name} is about ${fmt(quote.maxFee)} USDC, more than this wallet holds.`}
      </p>
      <button onClick={send} disabled={!canSend} className="mt-2 h-10 w-full border-2 border-arb font-display text-[15px] uppercase text-arb hover:bg-arb hover:text-ink disabled:opacity-40">
        {phase.step === "signing" ? "Confirm in your wallet…" : phase.step === "burning" ? "Burning on Arc…" : `Send to ${dest.name}`}
      </button>
      {phase.step === "error" && (
        <p role="alert" className="mt-2 border border-kapow/60 bg-kapow/10 px-3 py-2 text-[12.5px] text-paper">
          {phase.message}
        </p>
      )}
      {(phase.step === "burning" || phase.step === "tracking") && (
        <div role="status" className="mt-2 border border-arb/30 px-3 py-2 text-[12.5px] leading-snug text-soft">
          <a href={txUrl(phase.tx)} target="_blank" rel="noreferrer" className="block font-mono text-arb hover:underline">
            Burn on Arc · {short(phase.tx, 10, 6)}
          </a>
          {phase.step === "tracking" &&
            (status?.forwardTxHash ? (
              <a href={`${dest.explorer}/tx/${status.forwardTxHash}`} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-arb hover:underline">
                Minted on {dest.name} · {short(status.forwardTxHash, 10, 6)}
              </a>
            ) : (
              <span className="mt-1 block">
                {status?.status === "complete" ? `Attested by Circle; forwarding to ${dest.name}…` : "Waiting for Circle's attestation…"}
                {status?.forwardState ? ` (${status.forwardState.toLowerCase()})` : ""}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
