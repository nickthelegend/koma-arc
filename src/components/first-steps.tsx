"use client";

import Link from "next/link";
import { KOMA, PRICE_PER_PAGE } from "@/lib/network";
import { useWallet } from "./wallet";

type Step = { key: string; title: string; body: string; done: boolean; action: React.ReactNode };

/**
 * A new wallet's shelf: three things to do, each ticked off from real state (USDC balance on Arc, coins held per
 * KOMA's index, issues minted), so the empty page says what to do next instead of "nothing here".
 */
export function FirstSteps({ issues, holdings }: { issues: number; holdings: number }) {
  const { usdc } = useWallet();

  const funded = usdc > 0;
  const steps: Step[] = [
    {
      key: "fund",
      title: funded ? `You have ${usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` : "Get USDC",
      body: KOMA.faucetUrl ? "Free test USDC from Circle. It is also your gas, so it is the only token you need." : "Send USDC on Arc to this wallet, or bridge it in with CCTP. It is also your gas.",
      done: funded,
      action: KOMA.faucetUrl ? (
        <a href={KOMA.faucetUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center bg-arb px-4 font-display text-[15px] uppercase text-ink">
          Get test USDC
        </a>
      ) : null,
    },
    {
      key: "make",
      title: "Make your first issue",
      body: `From ${PRICE_PER_PAGE.toFixed(2)} USDC a page, minted to you.`,
      done: issues > 0,
      action: (
        <Link href="/create" className="slant inline-flex h-10 items-center px-4 text-[15px]">
          Make a comic
        </Link>
      ),
    },
    {
      key: "back",
      title: "Back a character",
      body: "Holders vote on the next episode.",
      done: holdings > 0,
      action: (
        <Link href="/series" className="inline-flex h-10 items-center border border-rule px-4 font-display text-[15px] uppercase text-paper hover:border-kapow">
          Browse series
        </Link>
      ),
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;

  return (
    <section data-first-steps aria-labelledby="first-h" className="mt-8 border border-rule bg-stock p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="first-h" className="font-display text-[24px] uppercase leading-none text-paper">
          Start here
        </h2>
        <p className="font-mono text-[12px] text-mute">
          {3 - left} of 3 done
        </p>
      </div>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key} data-step={s.key} data-done={s.done || undefined} className={`flex flex-col gap-2 border p-4 ${s.done ? "border-[#5ad17a]/50" : "border-rule"}`}>
            <span className={`font-mono text-[12px] ${s.done ? "text-[#5ad17a]" : "text-kapow"}`}>{s.done ? "✓ done" : `Step ${i + 1}`}</span>
            <span className="font-display text-[19px] uppercase leading-tight text-paper">{s.title}</span>
            <span className="text-[13px] leading-relaxed text-soft">{s.body}</span>
            {!s.done && <span className="mt-auto pt-2">{s.action}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
