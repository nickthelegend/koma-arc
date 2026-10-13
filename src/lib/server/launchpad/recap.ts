import { llm } from "../ai";
import { assertBudget, estimate } from "../budget";
import { db } from "./db";
import { canonView, seriesRow } from "./queries";

/**
 * "Previously on…": a two-sentence recap of a series' canon so far, written by Kimi once per settled episode from
 * the canon issues' titles and loglines, then cached. A new canon episode gets a new recap; nothing else calls the model.
 */
export type Recap = { seriesId: number; episode: number; text: string; model: string };

let ready = false;
function table() {
  const d = db();
  if (!ready) {
    d.exec("CREATE TABLE IF NOT EXISTS lp_recaps (series_id INTEGER NOT NULL, episode INTEGER NOT NULL, text TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (series_id, episode))");
    ready = true;
  }
  return d;
}

const inFlight = new Map<string, Promise<Recap | null>>();

export async function recapFor(seriesId: number): Promise<Recap | null> {
  const r = seriesRow(seriesId);
  if (!r) return null;
  const view = await canonView(seriesId);
  const canon = view.canon.filter((c) => c.issue).sort((a, b) => a.episode - b.episode);
  if (!canon.length) return null;
  const episode = canon.at(-1)!.episode;
  const hit = table().prepare("SELECT text, model FROM lp_recaps WHERE series_id = ? AND episode = ?").get(seriesId, episode) as { text: string; model: string } | undefined;
  if (hit) return { seriesId, episode, ...hit };
  const key = `${seriesId}:${episode}`;
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      (async () => {
        const est = estimate.llm("chat");
        assertBudget(est);
        const trace = { toolCalls: [] as string[], model: "" };
        const story = canon.map((c) => `Episode ${c.episode}: ${c.issue!.title}. ${c.issue!.logline}`).join("\n");
        const out = await llm({
          role: "script",
          estimateUsd: est,
          maxTokens: 300,
          trace,
          system: 'You write the "Previously on…" line of a comic series. Two short sentences, at most 40 words, present tense, no spoilers beyond what is given, no hype words. Answer as JSON: {"recap": "..."}',
          prompt: `Series: ${r.name}, starring ${r.character_name ?? r.name}.\nPremise: ${r.pitch ?? ""}\nCanon so far:\n${story}`,
        });
        let text = "";
        try {
          text = String((JSON.parse(out) as { recap?: string }).recap ?? "").trim();
        } catch {
          text = out.trim();
        }
        if (!text) return null;
        text = text.split(/\s+/).slice(0, 48).join(" ");
        const model = (trace.model || "Kimi").replace(/ \(via fal\)$/, "");
        table().prepare("INSERT OR REPLACE INTO lp_recaps (series_id, episode, text, model, at) VALUES (?, ?, ?, ?, ?)").run(seriesId, episode, text, model, Math.floor(Date.now() / 1000));
        return { seriesId, episode, text, model };
      })().finally(() => inFlight.delete(key)),
    );
  }
  return inFlight.get(key)!;
}
