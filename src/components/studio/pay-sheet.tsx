"use client";

import { useEffect, useRef } from "react";
import type { GenState, Quote } from "./use-generation";
import { ArcMark, IconClose } from "../icons";
import { short } from "@/lib/format";
import { KOMA } from "@/lib/network";
import { useWallet } from "../wallet";
import { FaucetHint } from "../launchpad/faucet-hint";

/** What the sheet needs from a paid flow: the studio's GenState, or a series launch. */
type PayState = Pick<GenState, "quoteError"> & { stage: string; quote?: Quote };

/** Words that change with what is being bought. Defaults describe a comic issue. */
type Copy = { noun: string; after: string; back: string };
const ISSUE: Copy = { noun: "issue", after: "drawing starts once it lands", back: "Back to the studio" };

/**
 * The HTTP 402 moment. The server answered "payment required" with a quote;
 * this sheet shows that quote in plain words and asks for one signature.
 */
export function PaySheet({ state, onPay, onCancel, copy = ISSUE }: { state: PayState; onPay: () => void; onCancel: () => void; copy?: Copy }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { address, usdc, usdcLoaded, connect, connecting, error: walletError } = useWallet();
  const open = state.stage === "quote" || state.stage === "signing";
  const q = state.quote;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const tooLow = address && q && usdcLoaded && Number(q.amount) > usdc;
  const problem = state.quoteError ?? walletError;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (state.stage === "quote") onCancel();
      }}
      className="mb-0 mt-auto w-full max-w-none bg-transparent p-0 text-paper backdrop:bg-black/75 backdrop:backdrop-blur-sm md:m-auto md:w-[460px]"
    >
      <div className="border-t-4 border-kapow bg-stock pb-[max(env(safe-area-inset-bottom),20px)] md:border md:border-t-4 md:border-rule md:border-t-kapow md:pb-0">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="font-mono text-[11.5px] text-kapow">{q ? "HTTP 402 · Payment required" : `Can't quote this ${copy.noun}`}</p>
            <p className="mt-1 font-display text-[34px] uppercase leading-none">{q ? `Pay ${q.amount} USDC` : "Not yet"}</p>
          </div>
          {state.stage === "quote" && (
            <button onClick={onCancel} aria-label="Cancel" className="-mr-1 p-1 text-mute hover:text-paper">
              <IconClose />
            </button>
          )}
        </div>

        {q && (
          <>
            <dl className="mx-5 mt-5 border border-rule bg-ink text-[13px]">
              {[
                ["Network", <span key="n" className="flex items-center gap-1.5"><ArcMark /> {KOMA.label}</span>],
                ["Token", <span key="t">USDC <span className="font-mono text-[11.5px] text-mute">{short(q.asset)}</span></span>],
                ["Pay to", <span key="p" className="font-mono text-[12px]">{short(q.payTo)}</span>],
                ["Settled by", "KOMA facilitator"],
                ["Gas", "None for you"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between gap-4 border-t border-rule px-3.5 py-2.5 first:border-t-0">
                  <dt className="text-mute">{k}</dt>
                  <dd className="text-right text-paper">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mx-5 mt-4 text-[12.5px] leading-relaxed text-mute">
              Your wallet signs a one-time USDC transfer authorization for exactly this amount. The facilitator submits it on
              Arc, and {copy.after}. The signature can&rsquo;t be reused.
            </p>
          </>
        )}

        {problem && (
          <p role="alert" className="mx-5 mt-4 border border-kapow/60 bg-kapow/10 px-3 py-2.5 text-[13px] leading-snug text-paper">
            {problem}
          </p>
        )}

        <div className="px-5 pb-5 pt-5">
          {!q ? (
            <button onClick={onCancel} className="h-12 w-full border-2 border-paper/80 font-display text-[18px] uppercase hover:bg-paper hover:text-ink">
              {copy.back}
            </button>
          ) : !address ? (
            <button onClick={connect} disabled={connecting} className="slant w-full py-3.5 text-[20px]">
              {connecting ? "Connecting…" : "Connect wallet to pay"}
            </button>
          ) : tooLow ? (
            <FaucetHint need={Number(q.amount)} noun={`this ${copy.noun}`} />
          ) : (
            <button onClick={onPay} disabled={state.stage === "signing"} className="slant w-full py-3.5 text-[20px]">
              {state.stage === "signing" ? "Confirm in your wallet…" : `Sign & pay ${q.amount} USDC`}
            </button>
          )}
          {address && q && (
            <p className="mt-3 text-center text-[12px] text-mute">
              Paying from <span className="font-mono">{short(address)}</span> · {usdcLoaded ? usdc.toFixed(2) : "…"} USDC available
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
