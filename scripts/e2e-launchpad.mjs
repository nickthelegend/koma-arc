// End-to-end launchpad checks against a running KOMA server on Arc testnet.
// All real: x402-paid launches, fal character sheets, gasless trades relayed on
// chain, signed canon votes, the keeper's finalization, graduation into v4, and a
// character's earnings sent cross-chain with CCTP.
//   node scripts/e2e-launchpad.mjs [only=L1,L2,...]
// Env: KOMA_URL (default http://localhost:4310), KOMA_ENV_FILE (.env.local), KOMA_RPC.
// The TEST_* wallets must already hold testnet USDC (sh scripts/testnet-setup.sh). Amounts are sized for one
// demo series (graduates at 5 USDC): about 15 USDC across the wallets, plus the server's gas.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, encodeAbiParameters, formatUnits, http, keccak256, parseAbi, parseUnits, stringToBytes, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient, decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { USDC_DOMAIN, paidNoGas, requireUsdc } from "./lib/usdc.mjs";
import { recordProof } from "./lib/proof.mjs";

const BASE = process.env.KOMA_URL ?? "http://localhost:4310";
const envFile = process.env.KOMA_ENV_FILE ?? ".env.local";
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const status = await (await fetch(`${BASE}/api/status`)).json();
const RPC = process.env.KOMA_RPC ?? (env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.io");
const chain = createPublicClient({ transport: http(RPC) });
const chainId = await chain.getChainId();
const only = process.argv.find((a) => a.startsWith("only="))?.slice(5).split(",");
const run = (id) => !only || only.includes(id);
const LP = status.launchpad?.addresses;
const USDC = status.usdc;

const results = [];
// While fal is down nothing can be drawn, so launches and episode proposals are refused before any
// payment. Those checks are reported UNTESTED; `npm run check:economics` covers trading, fees,
// remix royalties, anti-snipe and graduation without fal (it launches through SeriesFactory).
const aiDown = status.ai?.ok === false;
const untested = [];
function check(id, name, ok, detail = "") {
  results.push({ id, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (path) => (await fetch(`${BASE}${path}`, { cache: "no-store" })).json();
const postJson = (path, body, headers = {}) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const coinAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function getVotes(address) view returns (uint256)",
]);
const curveAbi = parseAbi([
  "function quoteBuy(uint256 usdcIn) view returns (uint256 coinOut, uint256 fee, uint256 usdcUsed)",
  "function quoteSell(uint256 coinIn) view returns (uint256 usdcOut, uint256 fee)",
  "function sellNonces(address) view returns (uint256)",
  "function state() view returns (uint256 vU, uint256 vC, uint256 raised, uint256 target, bool complete, bool graduated, uint256 launchedAt)",
]);
const nftAbi = parseAbi(["function ownerOf(uint256) view returns (address)", "function accountOf(uint256) view returns (address)"]);
const canonAbi = parseAbi(["function canonOf(uint256 seriesId, uint256 episode) view returns (uint256)", "function nextEpisode(uint256) view returns (uint256)"]);

const usdc = (a) => chain.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] });
const coinBal = (coin, a) => chain.readContract({ address: coin, abi: coinAbi, functionName: "balanceOf", args: [a] });
const U = (n) => parseUnits(String(n), 6);
const fmtU = (x) => formatUnits(x, 6);
const fmtC = (x) => Number(formatUnits(x, 18)).toLocaleString("en-US");

const who = {
  creator: privateKeyToAccount(env.TEST_BROWSER_KEY),
  agent: privateKeyToAccount(env.TEST_AGENT_KEY),
  empty: privateKeyToAccount(env.TEST_EMPTY_KEY),
  payto: privateKeyToAccount(env.TEST_PAYTO_KEY),
  // A new wallet every run for the "holds nothing" checks, so no shared test wallet changes state.
  fresh: privateKeyToAccount(generatePrivateKey()),
};

const proofs = {};
const nativeOf = (a) => chain.getBalance({ address: a });
const arc = { id: chainId, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
/** A plain USDC transfer from a test wallet (a wallet-sent tx: gas in USDC). */
async function sendUsdc(from, to, amount) {
  const w = createWalletClient({ account: from, chain: arc, transport: http(RPC) });
  const hash = await w.writeContract({ address: USDC, abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: [to, amount] });
  await chain.waitForTransactionReceipt({ hash });
}

// ——— x402 payments ———
const payer = (acct) =>
  new x402HTTPClient(
    x402Client.fromConfig({
      schemes: [{ network: status.caip, client: new ExactEvmScheme(acct) }],
      spendControls: { allowedAssets: [{ network: status.caip, asset: USDC, maxAmountPerPayment: "1800000" }] },
    }),
  );
async function paidPost(path, body, acct) {
  const first = await postJson(path, body);
  if (first.status !== 402) return first;
  const http402 = payer(acct);
  const required = http402.getPaymentRequiredResponse((n) => first.headers.get(n));
  const header = http402.encodePaymentSignatureHeader(await http402.createPaymentPayload(required));
  return postJson(path, body, header);
}

async function pollLaunch(id, timeoutMs = 240_000) {
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    const job = await getJson(`/api/launches/${id}`);
    if (job.stage !== last) console.log(`     launch ${id}: ${job.stage}`);
    last = job.stage;
    if (job.stage === "done" || job.stage === "error") return job;
    await sleep(1500);
  }
  throw new Error("launch timeout");
}
async function pollJob(id, timeoutMs = 480_000) {
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    const job = await getJson(`/api/jobs/${id}`);
    const line = `${job.stage}${job.stage === "drawing" ? ` ${job.drawn}/${job.total}` : ""}`;
    if (line !== last) console.log(`     job ${id}: ${line}`);
    last = line;
    if (job.stage === "done" || job.stage === "error") return job;
    await sleep(1500);
  }
  throw new Error("job timeout");
}
async function seriesWhenIndexed(id, pred = () => true, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const res = await fetch(`${BASE}/api/series/${id}`, { cache: "no-store" });
    if (res.ok) {
      const s = await res.json();
      if (pred(s)) return s;
    }
    await sleep(1000);
  }
  throw new Error(`series ${id} not indexed in time`);
}

// ——— Gasless intents (same signing the browser does) ———
async function signBuy(acct, curve, usdcIn, minCoinOut) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const salt = toHex(randomBytes(32));
  const nonce = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [keccak256(stringToBytes("KOMA_BUY_V1")), curve, acct.address, usdcIn, minCoinOut, deadline, salt],
    ),
  );
  const signature = await acct.signTypedData({
    domain: { ...USDC_DOMAIN, chainId, verifyingContract: USDC },
    types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "ReceiveWithAuthorization",
    message: { from: acct.address, to: curve, value: usdcIn, validAfter: BigInt(0), validBefore: deadline, nonce },
  });
  return { kind: "buy", curve, buyer: acct.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature };
}
async function signSell(acct, curve, coin, coinIn, minUsdcOut) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const [name, pnonce, snonce] = await Promise.all([
    chain.readContract({ address: coin, abi: coinAbi, functionName: "name" }),
    chain.readContract({ address: coin, abi: coinAbi, functionName: "nonces", args: [acct.address] }),
    chain.readContract({ address: curve, abi: curveAbi, functionName: "sellNonces", args: [acct.address] }),
  ]);
  const permit = await acct.signTypedData({
    domain: { name, version: "1", chainId, verifyingContract: coin },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: acct.address, spender: curve, value: coinIn, nonce: pnonce, deadline },
  });
  const intentSignature = await acct.signTypedData({
    domain: { name: "KOMA Curve", version: "1", chainId, verifyingContract: curve },
    types: { Sell: [{ name: "seller", type: "address" }, { name: "coinIn", type: "uint256" }, { name: "minUsdcOut", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }] },
    primaryType: "Sell",
    message: { seller: acct.address, coinIn, minUsdcOut, deadline, nonce: snonce },
  });
  return { kind: "sell", curve, seller: acct.address, coinIn: String(coinIn), minUsdcOut: String(minUsdcOut), deadline: String(deadline), permit, intentSignature };
}
async function relay(body) {
  const res = await postJson("/api/trade/relay", body);
  const j = await res.json();
  if (!res.ok) return { error: j.error ?? `HTTP ${res.status}` };
  const receipt = await chain.waitForTransactionReceipt({ hash: j.txHash });
  if (receipt.status !== "success") return { error: `relayed tx ${j.txHash} reverted on chain`, receipt };
  return { txHash: j.txHash, receipt };
}
async function buy(acct, curve, usdcIn, slippageBps = 100) {
  const [coinOut] = await chain.readContract({ address: curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
  return relay(await signBuy(acct, curve, usdcIn, (coinOut * BigInt(10_000 - slippageBps)) / BigInt(10_000)));
}
async function vote(acct, seriesId, episode, issueId) {
  const signature = await acct.signTypedData({
    domain: { name: "KOMA Canon", version: "1", chainId, verifyingContract: LP.canonRegistry },
    types: { Vote: [{ name: "seriesId", type: "uint256" }, { name: "episode", type: "uint256" }, { name: "issueId", type: "uint256" }, { name: "voter", type: "address" }] },
    primaryType: "Vote",
    message: { seriesId: BigInt(seriesId), episode: BigInt(episode), issueId: BigInt(issueId), voter: acct.address },
  });
  const res = await postJson(`/api/canon/${seriesId}/vote`, { episode, issueId, voter: acct.address, signature });
  return { status: res.status, body: await res.json() };
}

const launchBody = (o = {}) => ({
  name: "Rust Bucket Riot",
  symbol: "RUST",
  characterName: "Juniper Vex",
  characterPrompt: "wiry teenage mechanic with a huge orange afro, brass welding goggles, mustard jumpsuit and a chunky silver prosthetic left arm",
  pitch: "A scrapyard mechanic builds a robot out of junk to win the city's illegal mech races and free her brother.",
  genre: "Sci-fi",
  demo: true,
  ...o,
});

// ——— L1 ———
if (run("L1")) {
  const ok = !!LP && LP.chainId === chainId && chainId === 5042002 && LP.engine === "solidity" && LP.poolManager && typeof status.relayerUsdc === "number";
  check("L1", "status reports the Arc testnet launchpad (addresses, engine, relayer USDC)", ok, LP ? `chain=${chainId} relayer=${status.relayerUsdc?.toFixed(4)} USDC v4=${LP.poolManager}` : "launchpad null");
  if (!LP) process.exit(1);
}

// Minimum balances per wallet; a live testnet run with small faucet amounts overrides them: KOMA_NEED='{"creator":2.4,"agent":2.6}'.
const need = process.env.KOMA_NEED ? JSON.parse(process.env.KOMA_NEED) : { creator: 4.5, agent: 6, payto: 4 };
for (const [k, a] of Object.entries(who)) if (need[k] && (!only || only.some((id) => ["L4", "L5", "L10", "L12", "L13"].includes(id)))) await requireUsdc(chain, a.address, U(need[k]), `TEST_${k.toUpperCase()}`);

// ——— L2 invalid launches ———
if (run("L2")) {
  const cases = [
    [{ name: "X" }, /Series name/],
    [{ symbol: "toolongticker" }, /Ticker/],
    [{ characterPrompt: "short" }, /character's look/],
    [{ parentSeriesId: 999999 }, /doesn't exist/],
  ];
  let all = true;
  for (const [o, re] of cases) {
    const res = await postJson("/api/series", launchBody(o));
    const j = await res.json().catch(() => ({}));
    const ok = res.status === 400 && re.test(j.error ?? "") && !res.headers.get("PAYMENT-REQUIRED");
    if (!ok) console.log(`     ✗ ${JSON.stringify(o)} → ${res.status} ${j.error}`);
    all &&= ok;
  }
  check("L2", "invalid launch requests → 400, no quote", all);
}

// ——— L3 quote ———
if (run("L3") && aiDown) {
  const res = await postJson("/api/series", launchBody());
  const body = await res.json().catch(() => ({}));
  check("L3", "fal down: launch quote refused with 503, no PAYMENT-REQUIRED, says no payment was taken", res.status === 503 && !res.headers.get("PAYMENT-REQUIRED") && /No payment was taken/.test(body.error ?? ""), `${res.status} ${body.error ?? ""}`);
  for (const id of ["L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"].filter(run)) untested.push(id);
  console.log(`UNTESTED L4–L12 paid launch and everything built on it — fal unavailable (${status.ai.reason}); run \`npm run check:economics\` for trading, fees and graduation without fal`);
} else if (run("L3")) {
  const res = await postJson("/api/series", launchBody());
  const a = res.status === 402 ? decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")).accepts[0] : null;
  check("L3", "launch quote: 402, 1.00 USDC, KOMA network", !!a && a.amount === "1000000" && a.asset.toLowerCase() === USDC.toLowerCase() && a.network === status.caip, a ? `${a.amount} → ${a.payTo}` : `HTTP ${res.status}`);
}

let S = null; // the main demo series
async function launch(acct, body) {
  const res = await paidPost("/api/series", body, acct);
  if (res.status !== 202) throw new Error(`launch ${res.status} ${JSON.stringify(await res.json().catch(() => ({})))}`);
  const { jobId } = await res.json();
  const job = await pollLaunch(jobId);
  if (job.stage !== "done") throw new Error(`launch failed: ${job.error}`);
  return seriesWhenIndexed(job.seriesId);
}

// ——— L4 paid launch ———
if (!aiDown && (run("L4") || run("L5") || run("L6") || run("L7") || run("L8") || run("L9") || run("L10") || run("L11") || run("L12"))) {
  const before = await usdc(who.creator.address);
  S = await launch(who.creator, launchBody());
  const [owner, account, supply, curveCoins, vestCoins, code] = await Promise.all([
    chain.readContract({ address: LP.characterNft, abi: nftAbi, functionName: "ownerOf", args: [BigInt(S.characterId)] }),
    chain.readContract({ address: LP.characterNft, abi: nftAbi, functionName: "accountOf", args: [BigInt(S.characterId)] }),
    chain.readContract({ address: S.coin, abi: coinAbi, functionName: "totalSupply" }),
    coinBal(S.coin, S.curve),
    coinBal(S.coin, S.vestingContract),
    chain.getCode({ address: S.characterAccount }),
  ]);
  const paid = before - (await usdc(who.creator.address));
  const ok =
    paid === U(1) && owner.toLowerCase() === who.creator.address.toLowerCase() && account.toLowerCase() === S.characterAccount.toLowerCase() && !!code && code !== "0x" &&
    supply === parseUnits("1000000000", 18) && curveCoins === parseUnits("950000000", 18) && vestCoins === parseUnits("50000000", 18) && S.demo && S.targetUsdc === 5 && !!S.sheetUrl;
  check("L4", "x402 launch: sheet drawn, Character NFT + live ERC-6551 wallet, 1B coins (950M curve / 50M vesting)", ok, `series #${S.id} $${S.symbol} tba=${S.characterAccount} paid=${fmtU(paid)}`);
  const job = (await getJson(`/api/series/${S.id}`));
  proofs.launch = { seriesId: S.id, coin: S.coin, curve: S.curve, characterAccount: S.characterAccount, launchTx: job.launchTx ?? null };
  const sheet = await fetch(`${BASE}${S.sheetUrl}`);
  check("L4b", "character sheet image is served", sheet.ok && (sheet.headers.get("content-type") ?? "").startsWith("image/"), `${sheet.status} ${(await sheet.arrayBuffer()).byteLength} bytes`);
}

// ——— L5 gasless buy + fee split ———
if (S && run("L5")) {
  const tbaBefore = await usdc(S.characterAccount);
  const treasBefore = await usdc(LP.treasury);
  const coinsBefore = await coinBal(S.coin, who.agent.address);
  const nBefore = await nativeOf(who.agent.address);
  const uBefore = await usdc(who.agent.address);
  const r = await buy(who.agent, S.curve, U(2.5));
  const got = (await coinBal(S.coin, who.agent.address)) - coinsBefore;
  const tba = (await usdc(S.characterAccount)) - tbaBefore;
  const treas = (await usdc(LP.treasury)) - treasBefore;
  const noGas = paidNoGas(nBefore, await nativeOf(who.agent.address), uBefore, await usdc(who.agent.address));
  // 1.5% of 2.5 USDC = 0.0375: 40% + the unused 20% remix share to the character (no parent) = 0.0225, 40% = 0.015 to the treasury.
  // (The treasury is also the deployer on testnet; nothing else moves it inside this check.)
  const ok = !r.error && got > BigInt(0) && tba === BigInt(22500) && treas === BigInt(15000) && noGas;
  check("L5", "gasless buy relayed: coins to buyer, 1.5% fee → 60% character wallet / 40% treasury, buyer paid no gas", ok, r.error ?? `${fmtC(got)} coins, tba +${fmtU(tba)}, treasury +${fmtU(treas)}, tx ${r.txHash}`);
  if (!r.error) proofs.gaslessBuy = r.txHash;
}

// ——— L6 slippage guard ———
if (S && run("L6")) {
  const before = await usdc(who.agent.address);
  const [coinOut] = await chain.readContract({ address: S.curve, abi: curveAbi, functionName: "quoteBuy", args: [U(1)] });
  const intent = await signBuy(who.agent, S.curve, U(1), coinOut * BigInt(2));
  const r = await relay(intent);
  const tampered = await signBuy(who.agent, S.curve, U(1), BigInt(1));
  tampered.minCoinOut = "0"; // relayer can't loosen the buyer's minimum: the USDC nonce commits to it
  const r2 = await relay(tampered);
  const after = await usdc(who.agent.address);
  check("L6", "slippage + tamper: min-out too high and a loosened min-out are both refused, no USDC moves", !!r.error && !!r2.error && after === before, `${r.error} / ${r2.error}`);
  // Below $1 the relayer declines: the trade would cost KOMA more gas than its fee.
  const small = await relay(await signBuy(who.agent, S.curve, U(0.5), BigInt(1)));
  check("L6b", "gasless buys under $1 are refused by the relayer, no USDC moves", /start at \$1/.test(small.error ?? "") && (await usdc(who.agent.address)) === before, small.error ?? "relayed");
}

// ——— L7 gasless sell ———
if (S && run("L7")) {
  const coins = await coinBal(S.coin, who.agent.address);
  const part = coins / BigInt(2);
  const [usdcOut] = await chain.readContract({ address: S.curve, abi: curveAbi, functionName: "quoteSell", args: [part] });
  const before = await usdc(who.agent.address);
  const r = await relay(await signSell(who.agent, S.curve, S.coin, part, (usdcOut * BigInt(99)) / BigInt(100)));
  const gained = (await usdc(who.agent.address)) - before;
  check("L7", "gasless sell relayed with permit + signed intent", !r.error && gained >= (usdcOut * BigInt(99)) / BigInt(100) && gained > BigInt(0), r.error ?? `sold ${fmtC(part)} for ${fmtU(gained)} USDC`);
  if (!r.error) proofs.gaslessSell = r.txHash;
  const dust = (await coinBal(S.coin, who.agent.address)) / BigInt(100);
  const smallSell = await relay(await signSell(who.agent, S.curve, S.coin, dust, BigInt(1)));
  check("L7b", "gasless sells worth under $1 are refused by the relayer", /start at \$1/.test(smallSell.error ?? ""), smallSell.error ?? "relayed");
}

// ——— L8 canon proposals ———
let proposal = null;
if (S && run("L8")) {
  const order = { prompt: "Juniper sneaks into the junkyard at night to steal a racing engine, but the engine is alive.", pages: 1, style: "retro-sf", seriesId: S.id };
  // The non-holder can afford the episode; holding no coins is what must stop it.
  await sendUsdc(who.creator, who.fresh.address, U(0.35));
  const before = await usdc(who.fresh.address);
  const deniedRes = await paidPost("/api/comics", order, who.fresh);
  const denied = await deniedRes.json().catch(() => ({}));
  const moved = (await usdc(who.fresh.address)) !== before;
  check("L8a", "non-holder proposal refused before any USDC moves", deniedRes.status === 403 && /1,000,000/.test(denied.error ?? "") && !moved, `${deniedRes.status} ${denied.error}`);
  const votes = await chain.readContract({ address: S.coin, abi: coinAbi, functionName: "getVotes", args: [who.agent.address] });
  const res = await paidPost("/api/comics", order, who.agent);
  const body = await res.json();
  if (res.status !== 202) throw new Error(`L8 episode payment not accepted: ${res.status} ${body.error ?? ""} (run L5 first: the proposer needs 1M coins)`);
  const job = await pollJob(body.jobId);
  const canon = await getJson(`/api/canon/${S.id}`);
  proposal = canon.proposals.find((p) => p.issueId === job.tokenId);
  const issue = await getJson(`/api/comics?owner=${who.agent.address}`);
  const tagged = issue.comics.find((c) => c.chain.tokenId === job.tokenId)?.series?.id === S.id;
  check("L8", "holder (≥1M coins, auto-delegated votes) pays, episode drawn with the character sheet, proposed for episode 1", job.stage === "done" && job.canon?.proposed && !!proposal && canon.episode === 1 && canon.slot?.open && tagged, `votes=${fmtC(votes)} issue #${job.tokenId} ${job.error ?? ""}`);
  proofs.episode = { issueId: job.tokenId, paymentTx: job.paymentTx, mintTx: job.mintTx };
}

// ——— L9 votes + finalize ———
if (S && proposal && run("L9")) {
  // The creator buys after the slot opened: that balance must not count (snapshot).
  await buy(who.creator, S.curve, U(1));
  const late = await vote(who.creator, S.id, 1, proposal.issueId);
  const good = await vote(who.agent, S.id, 1, proposal.issueId);
  const nobody = await vote(who.fresh, S.id, 1, proposal.issueId);
  check("L9a", "signed votes: holder counted at snapshot weight; late buyer and non-holder refused", good.status === 200 && Number(good.body.weight) > 0 && late.status === 403 && nobody.status === 403, `agent ${good.body.weight}, late ${late.status}, empty ${nobody.status}`);
  const canon = await getJson(`/api/canon/${S.id}`);
  // Windows run on block time (a local fork's clock can be far from the wall clock).
  const wait = Math.max(0, (canon.slot.endsAt - canon.chainTime) * 1000) + 15_000;
  console.log(`     waiting ${Math.round(wait / 1000)}s for the voting window to close and the keeper to finalize…`);
  const end = Date.now() + wait + 60_000;
  let winner = BigInt(0);
  await sleep(wait);
  while (Date.now() < end && winner === BigInt(0)) {
    winner = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "canonOf", args: [BigInt(S.id), BigInt(1)] });
    if (winner === BigInt(0)) await sleep(3000);
  }
  const after = await getJson(`/api/canon/${S.id}`);
  check("L9", "episode 1 finalized on chain by the keeper with the published votes root", winner === BigInt(proposal.issueId) && after.canon[0]?.issueId === proposal.issueId && /^0x[0-9a-f]{64}$/.test(after.canon[0]?.votesRoot ?? ""), `canonOf=${winner}`);
}

// ——— L10 remix royalties ———
if (S && run("L10")) {
  const R = await launch(who.payto, launchBody({ name: "Rust Bucket Relay", symbol: "RELAY", characterName: "Moss Vex", characterPrompt: "Juniper's little brother, freckled ten-year-old with a green bucket hat, oversized hoodie and a tablet full of stickers", parentSeriesId: S.id }));
  const parentBefore = await usdc(S.characterAccount);
  const childBefore = await usdc(R.characterAccount);
  const r = await buy(who.agent, R.curve, U(1));
  const parent = (await usdc(S.characterAccount)) - parentBefore;
  const child = (await usdc(R.characterAccount)) - childBefore;
  // fee 0.015: child 40% + half the 20% remix pool = 0.0075; parent gets the other half of the pool, 0.0015.
  check("L10", "remix series: fee flows up the remix tree (parent character wallet gets 10%, child 50%)", !r.error && parent === BigInt(1500) && child === BigInt(7500) && R.parentSeriesId === S.id, r.error ?? `parent +${fmtU(parent)}, child +${fmtU(child)}`);
}

// ——— L11 (anti-snipe) is covered by the unit tests: a 5 USDC demo curve can't sell 2% of supply in total. ———
let G = null;
if (!aiDown && run("L12")) {
  G = await launch(who.creator, launchBody({ name: "Graduation Day", symbol: "GRAD", characterName: "Pip Oduya", characterPrompt: "tall graduate student with round glasses, green braids, a patched denim jacket and a pocket full of chalk" }));
}

// ——— L12 graduation into Uniswap v4 ———
if (G && run("L12")) {
  await buy(who.agent, G.curve, U(2));
  await buy(who.payto, G.curve, U(2));
  const r = await buy(who.creator, G.curve, U(1.5)); // crosses 5: clipped to the target, rest refunded
  let s = null;
  try {
    s = await seriesWhenIndexed(G.id, (x) => x.graduated && x.pool, 90_000);
  } catch {}
  // 5% of the 5 USDC raised goes to the treasury at graduation; the pool gets the other 4.75.
  check("L12", "curve completes at 5 USDC, 5% graduation fee, the keeper graduates it into a Uniswap v4 pool with 4.75 USDC", !r.error && !!s?.pool && Math.abs(s.pool.usdc - 4.75) < 1e-6, r.error ?? (s ? `pool ${s.pool.poolId.slice(0, 18)}… ${s.pool.usdc} USDC + ${fmtC(parseUnits(String(s.pool.coins), 18))} coins` : "not graduated"));
  if (s?.pool && LP.swapper) {
    // After graduation: a gasless buy through the v4 pool (KomaSwapper.swapWithAuthorization via the relayer).
    const swapAbi = parseAbi(["function swapNonce(address buyer, uint256 seriesId, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt) view returns (bytes32)"]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const salt = toHex(randomBytes(32));
    const nonce = await chain.readContract({ address: LP.swapper, abi: swapAbi, functionName: "swapNonce", args: [who.payto.address, BigInt(G.id), U(1), BigInt(1), deadline, salt] });
    const signature = await who.payto.signTypedData({
      domain: { ...USDC_DOMAIN, chainId, verifyingContract: USDC },
      types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "ReceiveWithAuthorization",
      message: { from: who.payto.address, to: LP.swapper, value: U(1), validAfter: BigInt(0), validBefore: deadline, nonce },
    });
    const before = await coinBal(G.coin, who.payto.address);
    const nBefore = await nativeOf(who.payto.address);
    const uBefore = await usdc(who.payto.address);
    const r = await relay({ kind: "swap-buy", seriesId: G.id, buyer: who.payto.address, usdcIn: String(U(1)), minCoinOut: "1", deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature });
    const gained = (await coinBal(G.coin, who.payto.address)) - before;
    const noGas = paidNoGas(nBefore, await nativeOf(who.payto.address), uBefore, await usdc(who.payto.address));
    check("L12b", "gasless buy through the graduated v4 pool (relayed swapWithAuthorization), buyer paid no gas", !r.error && gained > BigInt(0) && noGas, r.error ?? `${fmtC(gained)} coins, tx ${r.txHash}`);
    if (!r.error) proofs.poolSwap = r.txHash;
  }
  if (s?.pool) proofs.graduation = { seriesId: G.id, poolId: s.pool.poolId };
}

// ——— L13 a character's earnings, cross-chain over CCTP ———
if (S && run("L13")) {
  const { cctpL13 } = await import("./lib/cctp.mjs");
  const out = await cctpL13({ chain, chainId, env, who, S, check, usdc, U, fmtU });
  if (out) proofs.cctp = out;
}

if (Object.keys(proofs).length) recordProof("launchpad", proofs);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.id).join(", ")}` : ""}${untested.length ? `, ${untested.length} untested (${untested.join(", ")})` : ""}`);
process.exit(failed.length ? 1 : 0);

