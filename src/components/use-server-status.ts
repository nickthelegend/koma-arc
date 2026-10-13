"use client";

import { useEffect, useState } from "react";

type Status = { ready: boolean; missing: string[]; launchpad: unknown; ai?: { ok: boolean; reason?: string; configured?: boolean; script?: string; editor?: string; image?: string } };

/**
 * What the studios need to know before offering to take a payment: whether the
 * server is configured, whether the launchpad is deployed, and whether the AI
 * provider can draw right now. Asked once on mount.
 */
export function useServerStatus() {
  const [s, setS] = useState<{ offline: string | null; aiDown: boolean; aiUnconfigured: boolean; launchpad: boolean; loaded: boolean; editor: string | null }>({
    offline: null,
    aiDown: false,
    aiUnconfigured: false,
    launchpad: true,
    loaded: false,
    editor: null,
  });
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((x: Status) => setS({ offline: x.ready ? null : x.missing.join(", "), aiDown: x.ready && x.ai?.ok === false, aiUnconfigured: x.ai?.configured === false,
          // Which model is the editor, for the studio's byline ("hunyuan:tencent/hy3 via fal" → "Hunyuan 3").
          editor: x.ai?.editor?.startsWith("hunyuan") ? "Hunyuan 3" : x.ai?.editor?.startsWith("kimi") ? "Kimi K2.6" : null, launchpad: Boolean(x.launchpad), loaded: true }))
      .catch(() => {});
  }, []);
  return s;
}

export const AI_DOWN_NOTE = "The AI artist is offline right now, so nothing can be drawn and no payment will be taken. Reading and trading still work.";

export const AI_UNCONFIGURED_NOTE =
  "This server has no AI models configured yet (Kimi, Hunyuan and fal), so the studio can't write or draw and no payment will be taken. Reading, trading and voting still work.";
