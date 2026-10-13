"use client";

import { useState } from "react";

/** Copies an <iframe> for the series' live card (/embed/s/<id>) so a creator can put it on their own site. */
export function EmbedButton({ seriesId, title }: { seriesId: number; title: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    const code = `<iframe src="${location.origin}/embed/s/${seriesId}" title="${title.replace(/"/g, "&quot;")} on KOMA" width="360" height="440" style="border:0" loading="lazy"></iframe>`;
    await navigator.clipboard.writeText(code).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }
  return (
    <button data-embed-button onClick={copy} className="inline-flex h-9 items-center border border-rule px-3 font-mono text-[11px] uppercase tracking-wide text-soft hover:border-paper hover:text-paper">
      {done ? "Embed code copied" : "</> Embed"}
    </button>
  );
}
