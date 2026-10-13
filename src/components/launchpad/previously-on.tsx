"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/ui";

type Recap = { episode: number; text: string; model: string };

/** "Previously on…": the canon so far in two sentences (written once per canon episode by the script model). */
export function PreviouslyOn({ seriesId }: { seriesId: number }) {
  const [r, setR] = useState<Recap | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/series/${seriesId}/recap`, { cache: "no-store" })
      .then((x) => x.json() as Promise<{ recap: Recap | null }>)
      .then((j) => live && setR(j.recap))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seriesId]);
  if (!r) return null;
  return (
    <aside data-previously-on={r.episode} className="mt-4 max-w-[60ch] border-l-2 border-kapow pl-3">
      <p className="font-display text-[13px] uppercase tracking-wide text-kapow">Previously on…</p>
      <p className="mt-0.5 text-[14.5px] leading-snug text-paper">{r.text}</p>
      <p className="mt-1.5">
        <Chip title={`Written by ${r.model} from the canon episodes, once per settled episode`}>
          to ep {r.episode} · {r.model.split("/").at(-1)}
        </Chip>
      </p>
    </aside>
  );
}
