"use client";

import { KOMA } from "@/lib/network";
import { useWallet } from "../wallet";

/**
 * Not enough USDC. On Arc testnet, Circle's faucet hands out test USDC (which is also the gas token); on Arc
 * mainnet, USDC arrives from an exchange or from any CCTP chain. Either way it is the only token a user needs.
 */
export function FaucetHint({ need, noun = "this" }: { need: number; noun?: string }) {
  const { usdc, refreshBalance } = useWallet();
  return (
    <div className="border border-kapow/50 px-3 py-3 text-[13px] leading-relaxed text-soft">
      Your wallet has {usdc.toFixed(2)} USDC on {KOMA.label}. Add at least {Math.max(0.01, need - usdc).toFixed(2)} more for {noun}.
      {KOMA.faucetUrl ? (
        <>
          {" "}Pick <b>Arc Testnet</b> on Circle&apos;s faucet; it sends test USDC in seconds, and that USDC also pays any gas.
          <a href={KOMA.faucetUrl} target="_blank" rel="noreferrer" className="mt-3 flex h-10 w-full items-center justify-center bg-arb font-display text-[16px] uppercase text-ink">
            Get test USDC from Circle
          </a>
          <button onClick={refreshBalance} className="mt-2 block w-full text-center font-mono text-[11px] uppercase tracking-wide text-mute underline">
            I&apos;ve got it, refresh my balance
          </button>
        </>
      ) : (
        <> Send USDC on Arc to this wallet from an exchange, or bridge it in from another chain with CCTP.</>
      )}
    </div>
  );
}
