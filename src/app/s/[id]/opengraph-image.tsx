import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { seriesDetail } from "@/lib/server/launchpad/queries";
import { artPath } from "@/lib/server/store";
import { coinPricePlain, usdAmount } from "@/lib/format";

export const runtime = "nodejs";
export const alt = "A KOMA series: the character, its coin and its canon";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0b0b0c";
const PAPER = "#f1ece2";
const KAPOW = "#ff4a1c";
const ARB = "#2ea3f2";

/** The card a series link unfurls into: its character sheet, name, coin and how far its story and curve have got. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const s = launchpad() && Number.isInteger(id) && id > 0 ? await seriesDetail(id) : null;
  let sheet: string | null = null;
  if (s?.sheetUrl) {
    const file = artPath(s.sheetUrl.split("/")[3] ?? "", "sheet.jpg");
    const bytes = file ? await readFile(file).catch(() => null) : null;
    if (bytes) sheet = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  }
  const pct = s && s.targetUsdc > 0 ? Math.min(100, Math.round((s.raisedUsdc / s.targetUsdc) * 100)) : 0;
  const stats: [string, string][] = s
    ? [
        ["Price", coinPricePlain(s.priceUsdc)],
        [s.graduated ? "Raised" : "To graduation", s.graduated ? usdAmount(s.raisedUsdc) : `${pct}%`],
        ["Holders", s.holders.toLocaleString("en-US")],
        ["Canon episodes", String(s.episodes)],
      ]
    : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: INK, color: PAPER, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: KAPOW, color: INK, padding: "14px 40px" }}>
          <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: -1 }}>KOMA</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Fans write the canon · on Arc</div>
        </div>
        <div style={{ display: "flex", flex: 1, padding: 36, gap: 36 }}>
          <div style={{ display: "flex", width: 560, height: 315, background: "#e8e4db", border: `4px solid ${PAPER}`, alignSelf: "center" }}>
            {sheet ? (
              <img src={sheet} width={552} height={307} style={{ objectFit: "cover" }} alt="" />
            ) : (
              <div style={{ display: "flex", margin: "auto", color: INK, fontSize: 40, fontWeight: 900 }}>{s?.characterName ?? "KOMA"}</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
            <div style={{ fontSize: 62, fontWeight: 900, lineHeight: 1, textTransform: "uppercase" }}>{s?.name ?? "A KOMA series"}</div>
            {s && (
              <div style={{ display: "flex", fontSize: 28, marginTop: 14 }}>
                <span style={{ color: KAPOW }}>${s.symbol.trim()}</span>
                <span style={{ color: "#bdb6a9", marginLeft: 12 }}>starring {s.characterName}</span>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", marginTop: 30, gap: 26 }}>
              {stats.map(([k, v]) => (
                <div key={k} style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 18, color: "#8f897e" }}>{k}</span>
                  <span style={{ fontSize: 32, color: k === "Price" ? ARB : PAPER }}>{v}</span>
                </div>
              ))}
            </div>
            {s && !s.graduated && (
              <div style={{ display: "flex", marginTop: 26, height: 12, width: 480, background: "#2a2a2e" }}>
                <div style={{ display: "flex", width: `${pct}%`, background: ARB }} />
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
