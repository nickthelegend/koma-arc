"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Page } from "@/lib/types";
import { ComicPage, ComicPanel } from "./comic-page";

type Mode = "scroll" | "pages" | "guided";
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "scroll", label: "Scroll", hint: "Every page, top to bottom" },
  { key: "pages", label: "Pages", hint: "One page at a time" },
  { key: "guided", label: "Guided", hint: "Panel by panel, the way a phone reader does it" },
];
const PREF = "koma:reader-mode";

/** Tells ReaderChrome which page is showing when the reader isn't scrolling. */
const announce = (page: number) => window.dispatchEvent(new CustomEvent("koma:reader-page", { detail: page }));

/**
 * The reader: scroll through the issue, turn its pages, or read it panel by panel ("guided"), with each panel
 * shown large with its lettering. Arrow keys, space, swipes and the buttons all turn; full screen hides the chrome.
 */
export function ReaderStage({ pages }: { pages: Page[] }) {
  const [mode, setMode] = useState<Mode>("scroll");
  const [step, setStep] = useState(0);
  const [full, setFull] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  // Every panel in reading order, with the page it belongs to (guided mode steps through these).
  const panels = useMemo(() => pages.flatMap((p, pi) => p.panels.map((panel, i) => ({ panel, page: pi, index: i }))), [pages]);
  const total = mode === "guided" ? panels.length : pages.length;

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = localStorage.getItem(PREF) as Mode | null;
        if (saved && MODES.some((m) => m.key === saved)) setMode(saved);
      } catch {
        // No storage: start in scroll mode.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const choose = (m: Mode) => {
    // Keep your place when switching: guided ↔ pages map through the page of the current step.
    setStep((s) => (m === mode ? s : m === "guided" ? panels.findIndex((p) => p.page === (mode === "pages" ? s : 0)) : mode === "guided" ? panels[s]?.page ?? 0 : 0));
    setMode(m);
    try {
      localStorage.setItem(PREF, m);
    } catch {}
  };

  const go = useCallback((d: number) => setStep((s) => Math.max(0, Math.min(total - 1, s + d))), [total]);

  useEffect(() => {
    if (mode === "scroll") return;
    announce(mode === "guided" ? (panels[step]?.page ?? 0) + 1 : step + 1);
  }, [mode, step, panels]);

  useEffect(() => {
    if (mode === "scroll") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") setStep(0);
      else if (e.key === "End") setStep(total - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, go, total]);

  useEffect(() => {
    const onFull = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, []);
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch {
      // Full screen refused (iOS Safari on non-video elements): the reader still works in place.
    }
  };

  // Swipes: a horizontal drag of 40 px or more turns.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => (touch.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.clientX - t.x;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(e.clientY - t.y)) go(dx < 0 ? 1 : -1);
  };

  const current = mode === "guided" ? panels[step] : null;
  const position =
    mode === "guided" && current ? `Panel ${step + 1} of ${panels.length} · page ${current.page + 1}` : mode === "pages" ? `Page ${step + 1} of ${pages.length}` : null;

  return (
    <div ref={stage} className={`relative ${full ? "flex h-dvh flex-col overflow-auto bg-[#0a0a0a]" : ""}`}>
      {/* Mode switch + full screen */}
      <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3 px-3 pt-3 md:px-4">
        <div role="radiogroup" aria-label="Reading mode" className="flex border border-rule">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              title={m.hint}
              onClick={() => choose(m.key)}
              className={`px-3 py-1.5 font-display text-[14px] uppercase ${mode === m.key ? "bg-paper text-ink" : "text-soft hover:text-paper"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {position && (
            <span className="font-mono text-[12px] text-soft" aria-live="polite">
              {position}
            </span>
          )}
          <button type="button" onClick={toggleFull} className="border border-rule px-3 py-1.5 text-[12.5px] text-soft hover:text-paper" aria-pressed={full}>
            {full ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {mode === "scroll" ? (
        <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-2 pb-16 pt-4 md:gap-12 md:px-4 md:pt-8">
          {pages.map((p, i) => (
            <div key={i} id={`p${i + 1}`} data-page={i + 1} className="scroll-mt-20">
              <ComicPage page={p} number={i + 1} priority={i === 0} />
            </div>
          ))}
        </div>
      ) : (
        <div
          className={`flex select-none flex-col items-center px-2 pb-6 pt-4 [&_img]:pointer-events-none ${full ? "flex-1 justify-center" : ""}`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (touch.current = null)}
          onDragStart={(e) => e.preventDefault()}
          style={{ touchAction: "pan-y" }}
        >
          <div key={`${mode}-${step}`} className="w-full animate-[print-in_0.28s_ease-out] motion-reduce:animate-none">
            {mode === "pages" ? (
              <div className="mx-auto w-full" style={{ maxWidth: "min(860px, calc((100dvh - 190px) * 0.6))" }}>
                <ComicPage page={pages[step]} number={step + 1} priority />
              </div>
            ) : current ? (
              <div
                className="comic-sheet mx-auto w-full [container-type:inline-size]"
                style={{ maxWidth: current.panel.shape === "wide" ? "min(1100px, calc((100dvh - 170px) * 1.7778))" : "min(820px, calc(100dvh - 170px))" }}
              >
                <ComicPanel
                  panel={current.panel}
                  priority
                  sizes="(min-width: 1100px) 1100px, 100vw"
                  className={current.panel.shape === "wide" ? "aspect-[16/9]" : "aspect-square"}
                />
                <p className="sr-only">{current.panel.alt}</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex w-full max-w-[860px] items-center justify-between gap-3">
            <button type="button" onClick={() => go(-1)} disabled={step === 0} className="h-11 border border-paper/70 px-5 font-display text-[15px] uppercase text-paper hover:bg-paper hover:text-ink disabled:opacity-30">
              ← Back
            </button>
            <div className="h-1 flex-1 bg-rule" aria-hidden>
              <div className="h-full bg-kapow transition-[width] duration-300" style={{ width: `${((step + 1) / total) * 100}%` }} />
            </div>
            <button type="button" onClick={() => go(1)} disabled={step >= total - 1} className="slant h-11 px-6 text-[16px] disabled:opacity-30">
              Next →
            </button>
          </div>
          <p className="mt-2 hidden text-[11.5px] text-mute md:block">← → or space to turn · swipe on a phone</p>
        </div>
      )}
    </div>
  );
}
