// The product's main flows through the real UI, in headless Chromium, with real models and real signed
// transactions on the local Monad fork. The wallet is scripts/lib/wallet-shim.mjs: a real EIP-1193 wallet backed by
// a local test key (signatures and transactions are real; there's no approval popup).
//   W1 connect a wallet               W2 studio: a real Hunyuan editor turn → pay over x402 → a minted issue,
//   W3 the issue's page credits Kimi + Hunyuan Image 3              W4 a gasless buy from the trade widget
//   W5 a canon vote from the canon board (signed, free)             W6 launch a series from /launch ($1, real sheet)
//   W7 autopilot honestly "not configured" without Privy            W8 clean console, no failed requests
// Costs a few cents of fal credit (one 1-page issue, one character sheet). App on :4320, chain on :18643.
//   node scripts/e2e-browser.mjs     (ONLY=W4,W5 to run a subset)
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { setAusd } from "./lib/ausd.mjs";
import { installWallet } from "./lib/wallet-shim.mjs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const RPC = env.NEXT_PUBLIC_MONAD_RPC_URL || "http://127.0.0.1:18643";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (id) => !ONLY || ONLY.has(id);
const chain = createPublicClient({ transport: http(RPC) });
const LP = JSON.parse(readFileSync(".data/addresses.local.json", "utf8"));
const relayer = createWalletClient({ account: privateKeyToAccount(env.SERVER_PRIVATE_KEY), transport: http(RPC) });
const me = privateKeyToAccount(env.TEST_BROWSER_KEY);
const U = (n) => BigInt(Math.round(n * 1e6));
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

await setAusd(chain, me.address, U(40));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
const failed = [];
page.on("console", (m) => m.type() === "error" && !/Download the React DevTools|favicon/i.test(m.text()) && errors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
page.on("response", (r) => {
  // 402 is the x402 quote, by design; anything else ≥ 400 from our origin is a failure.
  if (r.url().startsWith(BASE) && r.status() >= 400 && r.status() !== 402) failed.push(`${r.status()} ${r.url().replace(BASE, "")}`);
});
const wallet = await installWallet(page, env.TEST_BROWSER_KEY, { rpc: RPC });

// ——— W1 connect ———
await page.goto(`${BASE}/series`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Connect wallet" }).first().click();
const short = `${me.address.slice(0, 6)}`;
await page.getByText(new RegExp(short, "i")).first().waitFor({ timeout: 15_000 });
check("W1", "connect: the injected wallet connects and the top bar shows its address", true, me.address);

// ——— W2/W3 studio → pay → minted issue ———
if (run("W2")) {
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  const box = page.getByPlaceholder("Tell the editor your idea…");
  await box.fill("A pigeon courier in a rain-soaked city delivers a letter that rewrites whoever reads it. One page, noir.");
  await box.press("Enter");
  const payBtn = page.getByRole("button", { name: /^Pay .* AUSD & draw$/ });
  // A real editor may ask a question before it pitches; answer like a user would, up to three times.
  for (let turn = 0; turn < 4; turn++) {
    const replies = await page.getByText("Editor", { exact: true }).count();
    await payBtn.or(page.getByText("Editor", { exact: true }).nth(replies)).first().waitFor({ timeout: 120_000 });
    if (await payBtn.isVisible()) break;
    await page.waitForTimeout(1500);
    if (await payBtn.isVisible()) break;
    await box.fill("Sounds good. Go ahead and pitch it exactly like that, one page.");
    await box.press("Enter");
  }
  await payBtn.waitFor({ timeout: 120_000 });
  const price = (await payBtn.innerText()).match(/pay ([\d.]+)/i)?.[1];
  const before = await chain.readContract({ address: LP.usdc, abi: erc20, functionName: "balanceOf", args: [me.address] });
  await payBtn.click();
  const sign = page.getByRole("button", { name: /^Sign & pay/ });
  await sign.waitFor({ timeout: 30_000 });
  await sign.click();
  const t0 = Date.now();
  const read = page.getByRole("link", { name: "Read it" }).first();
  const retryBtn = page.getByRole("button", { name: /^Try again/ });
  let retried = 0;
  for (;;) {
    await read.or(retryBtn).first().waitFor({ timeout: 420_000 });
    if (await read.isVisible()) break;
    // A model or image call gave up: the paid job restarts from its saved work, with no second payment.
    if (++retried > 1) throw new Error(`job failed twice: ${await page.locator("section[aria-label='Your issue']").innerText()}`);
    console.log(`     job failed once (${(await page.locator("section[aria-label='Your issue'] p.text-soft").first().innerText().catch(() => "?")).slice(0, 120)}); retrying`);
    await retryBtn.click();
  }
  const href = await read.getAttribute("href");
  const after = await chain.readContract({ address: LP.usdc, abi: erc20, functionName: "balanceOf", args: [me.address] });
  const id = href?.split("/")[2];
  check("W2", "studio: a real Hunyuan pitch, one AUSD signature, drawn and minted", !!id && before - after === U(Number(price)), `$${price} paid, issue ${id} in ${Math.round((Date.now() - t0) / 1000)}s`);

  await page.goto(`${BASE}/c/${id}`, { waitUntil: "networkidle" });
  const credits = await page.locator("[data-credits]").innerText().catch(() => "");
  const comic = (await getJson("/api/comics")).comics.find((c) => c.id === id);
  check("W3", "the issue page credits the models that made it: Kimi wrote it, Hunyuan Image 3 drew the cover", /Kimi/.test(credits) && /Hunyuan Image 3/.test(credits) && comic?.chain?.tokenId > 0, credits);
}

// ——— W4 gasless buy from the trade widget ———
const series = (await getJson("/api/series")).series;
const open = series.find((s) => !s.complete && !s.graduated && s.targetUsdc >= 20);
if (run("W4") && open) {
  const coinAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const before = await chain.readContract({ address: open.coin, abi: coinAbi, functionName: "balanceOf", args: [me.address] });
  await page.goto(`${BASE}/s/${open.id}#trade`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("0.00").first().fill("3");
  const buy = page.getByRole("button", { name: "Sign & buy — no gas" });
  await buy.waitFor({ timeout: 15_000 });
  await buy.click();
  let after = before;
  for (let i = 0; i < 30 && after === before; i++) {
    await page.waitForTimeout(1000);
    after = await chain.readContract({ address: open.coin, abi: coinAbi, functionName: "balanceOf", args: [me.address] });
  }
  check("W4", "trade widget: a $3 buy with one signature and no gas, coins arrive on chain", after > before, `$${open.symbol}: +${(Number(after - before) / 1e18).toLocaleString("en-US")} coins`);
}

// ——— W5 a canon vote from the canon board ———
if (run("W5")) {
  // A series with an open slot this wallet can vote in: launched for us, bought into, one fresh issue proposed.
  const factoryAbi = parseAbi([
    "struct LaunchParams { address creator; string name; string symbol; string characterName; bytes32 sheetHash; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; }",
    "function launch(LaunchParams p) returns (uint256)",
    "event SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)",
  ]);
  const r = await chain.waitForTransactionReceipt({ hash: await relayer.writeContract({ chain: null, address: LP.seriesFactory, abi: factoryAbi, functionName: "launch", args: [{ creator: me.address, name: "Ballot Box", symbol: "VOTE", characterName: "Teller", sheetHash: keccak256(stringToBytes("w5")), parentSeriesId: 0n, graduationTarget: U(40), votingWindow: 600n }] }) });
  const S = parseEventLogs({ abi: factoryAbi, eventName: "SeriesLaunched", logs: r.logs })[0].args;
  for (let i = 0; i < 30 && !(await fetch(`${BASE}/api/series/${S.seriesId}`)).ok; i++) await page.waitForTimeout(1000);
  // Buy through the UI so the vote has weight at the snapshot.
  await page.goto(`${BASE}/s/${S.seriesId}#trade`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("0.00").first().fill("4");
  await page.getByRole("button", { name: "Sign & buy — no gas" }).click();
  const coinAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  let held = 0n;
  for (let i = 0; i < 30 && held === 0n; i++) {
    await page.waitForTimeout(1000);
    held = await chain.readContract({ address: S.coin, abi: coinAbi, functionName: "balanceOf", args: [me.address] });
  }
  if (held === 0n) throw new Error("W5: the UI buy didn't land");
  const issues = parseAbi(["function mint(address to, bytes32 contentHash, bytes32 paymentTx, uint16 pages, uint256 remixOf) returns (uint256)", "event IssueMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed paymentTx, bytes32 contentHash, uint256 remixOf, uint16 pages)"]);
  const m = await chain.waitForTransactionReceipt({ hash: await relayer.writeContract({ chain: null, address: LP.komaIssues, abi: issues, functionName: "mint", args: [me.address, keccak256(randomBytes(32)), keccak256(randomBytes(32)), 1, 0n] }) });
  const issueId = parseEventLogs({ abi: issues, eventName: "IssueMinted", logs: m.logs })[0].args.tokenId;
  await chain.request({ method: "evm_mine", params: [] });
  const canonAbi = parseAbi(["function propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256)"]);
  await chain.waitForTransactionReceipt({ hash: await relayer.writeContract({ chain: null, address: LP.canonRegistry, abi: canonAbi, functionName: "propose", args: [S.seriesId, issueId, me.address] }) });
  for (let i = 0; i < 20 && ((await getJson(`/api/canon/${S.seriesId}`)).proposals ?? []).length < 1; i++) await page.waitForTimeout(1000);
  await page.goto(`${BASE}/s/${S.seriesId}#canon`, { waitUntil: "networkidle" });
  const voteBtn = page.getByRole("button", { name: "Vote", exact: true }).first();
  await voteBtn.waitFor({ timeout: 20_000 });
  const voteRes = page.waitForResponse((r) => r.url().includes(`/api/canon/${S.seriesId}/vote`), { timeout: 30_000 });
  await voteBtn.click();
  const vr = await voteRes;
  if (!vr.ok()) throw new Error(`W5: vote answered ${vr.status()} ${JSON.stringify(await vr.json().catch(() => ({})))}`);
  await page.getByText("Your vote", { exact: true }).first().waitFor({ timeout: 20_000 });
  const view = await getJson(`/api/canon/${S.seriesId}`);
  const p = view.proposals.find((x) => x.issueId === Number(issueId));
  check("W5", "canon board: a free signed vote, counted at the holder's snapshot weight", p?.voters === 1 && p.votes > 0, `$VOTE episode 1, issue #${issueId}: ${p?.votes?.toLocaleString("en-US")} votes`);
}

// ——— W6 launch a series from /launch ———
if (run("W6")) {
  await page.goto(`${BASE}/launch`, { waitUntil: "networkidle" });
  const n = Date.now().toString(36).slice(-3).toUpperCase();
  await page.getByLabel("Series name").fill(`Night Ferry ${n}`);
  await page.getByLabel("Ticker").fill(`FR${n}`);
  await page.getByLabel("Character name").fill("Odile Marsh");
  await page.getByLabel("What they look like").fill("a lanky ferry captain with a grey braid, a teal oilskin coat and a brass lantern on her belt");
  await page.getByLabel("The pitch").fill("The last ferry of the night only takes passengers who have missed something important, and Odile has to get them back in time.");
  const pay = page.getByRole("button", { name: /^Pay .* AUSD & launch$/ });
  await pay.click();
  const sign = page.getByRole("button", { name: /^Sign & pay/ });
  await sign.waitFor({ timeout: 30_000 });
  await sign.click();
  const t0 = Date.now();
  // Paid → sheet drawn → one launch transaction → indexed: the studio then offers "Open $TICKER".
  const openLink = page.getByRole("link", { name: /^Open \$/ });
  await openLink.waitFor({ timeout: 300_000 });
  await openLink.click();
  await page.waitForURL(/\/s\/\d+/, { timeout: 30_000 });
  const sid = Number(page.url().match(/\/s\/(\d+)/)[1]);
  const s = await getJson(`/api/series/${sid}`);
  const sheet = s.sheetUrl ? await fetch(new URL(s.sheetUrl, BASE)) : null;
  const sheetBytes = sheet?.ok ? (await sheet.arrayBuffer()).byteLength : 0;
  check("W6", "launch: $1 over x402, a real character sheet, the series live on chain", s.name === `Night Ferry ${n}` && s.creator?.toLowerCase() === me.address.toLowerCase() && sheetBytes > 20_000, `series #${sid} $${s.symbol} in ${Math.round((Date.now() - t0) / 1000)}s, sheet ${Math.round(sheetBytes / 1024)} KB`);
}

// ——— W7 autopilot without Privy ———
if (run("W7") && open) {
  await page.goto(`${BASE}/s/${open.id}`, { waitUntil: "networkidle" });
  const panel = page.locator("section[aria-labelledby=autopilot-h]");
  const text = await panel.innerText().catch(() => "");
  check("W7", "autopilot panel: honestly off without Privy (no mock signer)", /not configured/.test(text) && /Privy session signer/.test(text), text.split("\n").slice(-1)[0]);
}

check("W8", "no console errors and no failed same-origin requests across every flow", errors.length === 0 && failed.length === 0, [...errors, ...failed].slice(0, 3).join(" | ") || `wallet calls: ${[...new Set(wallet.log)].join(", ")}`);
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
