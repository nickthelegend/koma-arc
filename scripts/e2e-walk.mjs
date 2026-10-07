// Product walk at phone width (375×812) in headless Chromium: every page of the app loads with a clean console,
// no failed requests, no horizontal scroll, and no copy left over from the Arbitrum base (Arbitrum, Arbiscan,
// "ETH" for gas). Saves a screenshot of each page to docs/screenshots/monad/ (WALK_SHOTS=0 to skip).
//   node scripts/e2e-walk.mjs        (app on :4320, local fork running)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const SHOTS = process.env.WALK_SHOTS !== "0" ? "docs/screenshots/monad" : null;
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();

// Real ids from this deployment.
const comics = (await getJson("/api/comics")).comics ?? [];
const series = (await getJson("/api/series")).series ?? [];
const comic = comics[0];
const graduated = series.find((s) => s.graduated && s.sheetUrl) ?? series.find((s) => s.graduated);
// Prefer series with real character art (the e2e suites also launch bare series straight on chain).
const open = series.find((s) => !s.graduated && !s.complete && s.sheetUrl) ?? series.find((s) => !s.graduated && !s.complete);
const pages = [
  ["home", "/"],
  ["series", "/series"],
  ["series-search", "/series?tab=graduated"],
  ...(open ? [["series-open", `/s/${open.id}`]] : []),
  ...(graduated ? [["series-graduated", `/s/${graduated.id}`]] : []),
  ["launch", "/launch"],
  ["studio", "/create"],
  ["studio-form", "/create/form"],
  ...(comic ? [["comic", `/c/${comic.id}`], ["reader", `/c/${comic.id}/read`], ["tx", `/tx/${comic.chain.paymentTx}`]] : []),
  ["search", "/search?q=kaiju"],
  ["shelf", "/shelf"],
  ["receipts", "/receipts"],
  ["how", "/how"],
  ["room", "/room"],
];

// Old-chain copy that must not appear anywhere a user can read.
const STALE = [/arbitrum/i, /arbiscan/i, /arb sepolia/i, /\bETH\b/, /sepolia/i, /stylus/i, /\bUSDC\b/];
const ALLOW_CONSOLE = [/Download the React DevTools/i, /favicon/i];

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const [name, path] of pages) {
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (m) => m.type() === "error" && !ALLOW_CONSOLE.some((r) => r.test(m.text())) && errors.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && u.startsWith(BASE)) failed.push(`${r.status()} ${u.replace(BASE, "")}`);
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(BASE) && !/_rsc=|net::ERR_ABORTED/.test(`${r.url()} ${r.failure()?.errorText}`)) failed.push(`failed ${r.url().replace(BASE, "")}`);
  });
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const text = await page.evaluate(() => document.body.innerText);
  const stale = STALE.filter((r) => r.test(text)).map((r) => text.match(r)?.[0]);
  const title = await page.title();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 78, fullPage: false });
  const ok = res?.status() === 200 && errors.length === 0 && failed.length === 0 && overflow <= 1 && stale.length === 0 && !!title;
  check(
    name,
    path,
    ok,
    ok ? title : [res?.status() !== 200 && `HTTP ${res?.status()}`, errors.length && `console: ${errors[0]}`, failed.length && `requests: ${failed.slice(0, 2).join(", ")}`, overflow > 1 && `overflow ${overflow}px`, stale.length && `stale copy: ${stale.join(", ")}`].filter(Boolean).join("; "),
  );
  await page.close();
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
