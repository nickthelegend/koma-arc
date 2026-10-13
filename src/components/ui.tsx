import type { ReactNode } from "react";

/**
 * The readability kit: a screen gets one headline per card, short chips instead of sentences, and everything else
 * (hashes, caveats, method notes) behind a collapsed "Details" that judges can still open.
 */
export function Chip({ children, tone = "mute", title }: { children: ReactNode; tone?: "mute" | "arb" | "kapow" | "ok"; title?: string }) {
  const c = { mute: "border-rule text-mute", arb: "border-arb/50 text-arb", kapow: "border-kapow/60 text-kapow", ok: "border-[#5ad17a]/60 text-[#5ad17a]" }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wide ${c}`}>
      {children}
    </span>
  );
}

export function Details({ children, label = "Details", className = "" }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <details data-details className={`group text-[12.5px] leading-relaxed text-mute ${className}`}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-mute hover:text-paper [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition-transform group-open:rotate-90">›</span> {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
