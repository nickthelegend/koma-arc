// The AI layer on real models (no fixtures): what /api/status says each role runs on, a real Hunyuan editor turn,
// and the credits recorded on real issues — Kimi wrote them, a series episode's script called get_series_canon,
// Hunyuan Image 3 drew the cover. Run after test:api and test:launchpad have made a regular issue and an episode.
//   node scripts/e2e-ai.mjs        (app on :4320 with FAL_KEY, or MOONSHOT_API_KEY + HUNYUAN_API_KEY + FAL_KEY)
const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();

const { ai } = await getJson("/api/status");
check("A1", "every role on a real model: Kimi writes, Hunyuan edits, fal draws (Hunyuan Image 3 for sheets/covers)", ai.configured && ai.ok && /^kimi:/.test(ai.script) && /^hunyuan:/.test(ai.editor) && ai.image === "fal" && ai.hunyuanImage, `script ${ai.script} · editor ${ai.editor} · image ${ai.image}${ai.hunyuanImage ? " + Hunyuan Image 3" : ""}`);

const t0 = Date.now();
const res = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "A lighthouse keeper discovers the light is the only thing keeping a sea serpent asleep. One page, noir." }] }),
});
const turn = await res.json();
check("A2", "a real Hunyuan editor turn: a reply and a valid, priced pitch", res.ok && turn.reply?.length > 10 && turn.pitch?.pages >= 1 && /^\d+\.\d\d$/.test(turn.pitch?.price ?? ""), res.ok ? `${((Date.now() - t0) / 1000).toFixed(1)}s, pitch "${turn.pitch?.title}" ${turn.pitch?.pages}p $${turn.pitch?.price}` : `${res.status} ${turn.error}`);

const comics = (await getJson("/api/comics")).comics ?? [];
const credited = comics.filter((c) => c.credits);
const regular = credited.find((c) => !c.series);
const episode = credited.find((c) => c.series);
check("A3", "a regular issue's credits: written by Kimi, cover by Hunyuan Image 3", !!regular && /kimi/i.test(regular.credits.writer) && regular.credits.art.some((a) => /Hunyuan Image 3/.test(a)), regular ? `${regular.title}: ${regular.credits.writer}; ${regular.credits.art.join(", ")}` : "no credited regular issue yet (run test:api)");
check("A4", "a series episode's script: Kimi called get_series_canon before writing", !!episode && /kimi/i.test(episode.credits.writer) && episode.credits.toolCalls.includes("get_series_canon"), episode ? `${episode.title} (${episode.series.name}): tools ${episode.credits.toolCalls.join(", ") || "none"}` : "no credited episode yet (run test:launchpad)");

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
