/**
 * Which model does what. Every role runs on a real model; with no credential for it the role is "off" and the
 * studio says it isn't configured (no placeholder output, ever).
 *
 *   script  — the comic's writer, with a get_series_canon tool call.  Kimi K2.6
 *   editor  — the chat that pitches.                                   Tencent Hunyuan 3 (hy3)
 *   image   — sheets, covers, panels.                                  fal: Hunyuan Image 3 for sheets/covers
 *                                                                      (HUNYUAN_IMAGE=1), FLUX.2 (+ edit) for panels
 *
 * Kimi and Hunyuan are reached directly (MOONSHOT_API_KEY → Moonshot, HUNYUAN_API_KEY → Tencent TokenHub) or, with
 * only FAL_KEY, through fal's OpenAI-compatible OpenRouter endpoint, which serves the same models (tool calls
 * included). The model is the same either way; only the route and the bill differ.
 */
export type TextFamily = "kimi" | "hunyuan";
export type TextRoute = { family: TextFamily; via: "direct" | "fal"; base: string; model: string; auth: string };
export type TextRole = "script" | "editor";
export type ImageProvider = "fal" | "off";

const env = (k: string) => (process.env[k] ?? "").trim();
const FAL_OPENAI = "https://fal.run/openrouter/router/openai/v1";

const DIRECT: Record<TextFamily, { base: () => string; model: () => string; key: () => string }> = {
  kimi: {
    base: () => env("MOONSHOT_BASE_URL") || "https://api.moonshot.ai/v1",
    model: () => env("KIMI_MODEL") || "kimi-k2.6",
    key: () => env("MOONSHOT_API_KEY"),
  },
  hunyuan: {
    base: () => env("HUNYUAN_BASE_URL") || "https://tokenhub-intl.tencentcloudmaas.com/v1",
    model: () => env("HUNYUAN_MODEL") || "hy3",
    key: () => env("HUNYUAN_API_KEY"),
  },
};
/** The same models on OpenRouter, as fal serves them. */
const ON_FAL: Record<TextFamily, () => string> = {
  kimi: () => env("KIMI_FAL_MODEL") || "moonshotai/kimi-k2.6",
  hunyuan: () => env("HUNYUAN_FAL_MODEL") || "tencent/hy3",
};

function route(family: TextFamily): TextRoute | null {
  const d = DIRECT[family];
  if (d.key()) return { family, via: "direct", base: d.base(), model: d.model(), auth: `Bearer ${d.key()}` };
  if (env("FAL_KEY")) return { family, via: "fal", base: FAL_OPENAI, model: ON_FAL[family](), auth: `Key ${env("FAL_KEY")}` };
  return null;
}

/** The model for a role: its own family first, the other one if that has no route at all. Null: not configured. */
export function textRoute(role: TextRole): TextRoute | null {
  const [first, second]: TextFamily[] = role === "script" ? ["kimi", "hunyuan"] : ["hunyuan", "kimi"];
  return route(first) ?? route(second);
}

export function imageProvider(): ImageProvider {
  return env("FAL_KEY") ? "fal" : "off";
}

/** Hunyuan Image 3 (on fal) draws character sheets when HUNYUAN_IMAGE=1. */
export const hunyuanImage = () => imageProvider() === "fal" && env("HUNYUAN_IMAGE") === "1";
/**
 * …and issue covers too, unless HUNYUAN_COVERS=0. A Hunyuan cover is $0.10 (fal bills at least 1 MP), which puts a
 * 1-page issue (sold at $0.10) at about $0.15 to make; FLUX.2 covers bring it back to ~$0.06.
 */
export const hunyuanCovers = () => hunyuanImage() && env("HUNYUAN_COVERS") !== "0";

/** Whether a model reasons before answering on the fal route (see openaiChat). */
const thinks = (f: TextFamily) => (f === "kimi" ? env("KIMI_REASONING") === "on" : env("HUNYUAN_REASONING") !== "off");

const describe = (r: TextRoute | null) => (r ? `${r.family}:${r.model}${r.via === "fal" ? " via fal" : ""}` : "off");

/** For /api/status: what each role runs on, and what's missing. */
export function aiSummary() {
  const script = textRoute("script");
  const editor = textRoute("editor");
  const image = imageProvider();
  const missing = [!script && "a script model (MOONSHOT_API_KEY or FAL_KEY)", !editor && "an editor model (HUNYUAN_API_KEY or FAL_KEY)", image === "off" && "FAL_KEY for art"].filter(
    Boolean,
  ) as string[];
  return { configured: missing.length === 0, missing, script: describe(script), editor: describe(editor), image, hunyuanImage: hunyuanImage(), hunyuanCovers: hunyuanCovers() };
}

// ——— OpenAI-compatible chat (Moonshot, Tencent TokenHub, or fal's OpenRouter endpoint) ———
export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string; reasoning?: string }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Tool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

type ChatResponse = {
  choices: { message: { content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string; reasoning?: string }; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

export async function openaiChat(
  r: TextRoute,
  o: { messages: ChatMsg[]; maxTokens?: number; json?: boolean; tools?: Tool[]; timeoutMs?: number },
): Promise<ChatResponse["choices"][number]["message"] & { usage?: ChatResponse["usage"] }> {
  const res = await fetch(`${r.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: r.auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: r.model,
      messages: o.messages,
      max_tokens: o.maxTokens ?? 2_000,
      temperature: 0.8,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      ...(o.tools ? { tools: o.tools, tool_choice: "auto" } : {}),
      // On OpenRouter (via fal) both models think before answering by default. Kimi's think is ~5× the tokens and
      // can use up max_tokens before the script, so it's off for Kimi (KIMI_REASONING=on to keep it). Hunyuan 3 keeps
      // it: without it the editor's JSON drifts (HUNYUAN_REASONING=off to drop it).
      ...(r.via === "fal" && !thinks(r.family) ? { reasoning: { enabled: false } } : {}),
    }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw new Error(`${describe(r)} ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const body = (await res.json()) as ChatResponse;
  const msg = body.choices?.[0]?.message;
  if (!msg) throw new Error(`${describe(r)} returned no message`);
  return { ...msg, usage: body.usage };
}
