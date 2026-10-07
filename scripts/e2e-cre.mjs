// Chainlink CRE canon settlement end to end on the local fork: two holders vote on two proposals, the window
// closes, the keeper leaves the slot to CRE (KOMA_CANON_FINALIZER=cre), and the koma-canon workflow's rules —
// signatures verified, weights re-read at the snapshot — settle it through the Keystone forwarder into
// CanonSettler, which finalizes it on the registry. The app then shows it as settled by Chainlink CRE.
//   App: KOMA_CANON_FINALIZER=cre (and a CanonSettler in the address book: scripts/local-setup.sh deploys it).
//   node scripts/e2e-cre.mjs
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi, parseEventLogs, stringToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chromium } from "playwright";
import { AUSD_DOMAIN, setAusd } from "./lib/ausd.mjs";
import { creSettles, settleViaCre, waitForWindow } from "./lib/cre.mjs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const RPC = env.NEXT_PUBLIC_MONAD_RPC_URL || "http://127.0.0.1:18643";
const chain = createPublicClient({ transport: http(RPC) });
const LP = JSON.parse(readFileSync(".data/addresses.local.json", "utf8"));
const chainId = await chain.getChainId();
const relayer = createWalletClient({ account: privateKeyToAccount(env.SERVER_PRIVATE_KEY), transport: http(RPC) });
const creator = privateKeyToAccount(env.TEST_AGENT_KEY);
const small = privateKeyToAccount(env.TEST_BROWSER_KEY);
const U = (n) => BigInt(Math.round(n * 1e6));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();
const post = (p, body) => fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const wait = async (hash) => chain.waitForTransactionReceipt({ hash });

const settlerAbi = parseAbi(["function registry() view returns (address)", "function getForwarderAddress() view returns (address)", "function settledCount() view returns (uint256)"]);
const canonAbi = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function RELAYER_ROLE() view returns (bytes32)",
  "function propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256)",
  "function canonOf(uint256 seriesId, uint256 episode) view returns (uint256)",
  "function slot(uint256 seriesId, uint256 episode) view returns (uint64 snapshot, uint64 endsAt, bool finalized, uint256 winner, uint256 proposalCount)",
  "event CanonFinalized(uint256 indexed seriesId, uint256 indexed episode, uint256 winnerIssueId, bytes32 votesRoot, uint256 winnerVotes, uint256 totalVotes)",
]);

// C1: the settler is deployed, points at the registry and the forwarder, and holds RELAYER_ROLE; the app is in CRE mode.
const S0 = LP.canonSettler;
const role = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "RELAYER_ROLE" });
const wired = S0 && (await chain.readContract({ address: S0, abi: settlerAbi, functionName: "registry" })).toLowerCase() === LP.canonRegistry.toLowerCase()
  && (await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "hasRole", args: [role, S0] }));
const mode = await creSettles(BASE);
check("C1", "CanonSettler wired (registry, MockKeystoneForwarder, RELAYER_ROLE) and the app leaves canon to CRE", Boolean(wired) && mode, `settler ${S0}, forwarder ${S0 ? await chain.readContract({ address: S0, abi: settlerAbi, functionName: "getForwarderAddress" }) : "-"}, creSettles ${mode}`);
if (!wired || !mode) process.exit(1);

// A fresh series with a 60 s window; the creator and a smaller holder buy.
const factoryAbi = parseAbi([
  "struct LaunchParams { address creator; string name; string symbol; string characterName; bytes32 sheetHash; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; }",
  "function launch(LaunchParams p) returns (uint256)",
  "event SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)",
]);
const [launched] = parseEventLogs({
  abi: factoryAbi,
  eventName: "SeriesLaunched",
  logs: (await wait(await relayer.writeContract({ chain: null, address: LP.seriesFactory, abi: factoryAbi, functionName: "launch", args: [{ creator: creator.address, name: "Oracle Night", symbol: "ORCL", characterName: "Settle", sheetHash: keccak256(stringToBytes("cre")), parentSeriesId: 0n, graduationTarget: U(40), votingWindow: 60n }] }))).logs,
});
const S = launched.args;
for (let i = 0; i < 30 && !(await fetch(`${BASE}/api/series/${S.seriesId}`)).ok; i++) await sleep(1000);

const curveAbi = parseAbi(["function quoteBuy(uint256) view returns (uint256,uint256,uint256)"]);
async function buy(acct, n) {
  await setAusd(chain, acct.address, U(n + 1));
  const usdcIn = U(n);
  const [out] = await chain.readContract({ address: S.curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
  const minCoinOut = (out * 99n) / 100n, deadline = BigInt(Math.floor(Date.now() / 1000) + 3600), salt = toHex(randomBytes(32));
  const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(stringToBytes("KOMA_BUY_V1")), S.curve, acct.address, usdcIn, minCoinOut, deadline, salt]));
  const signature = await acct.signTypedData({ domain: { ...AUSD_DOMAIN, chainId, verifyingContract: LP.usdc }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: acct.address, to: S.curve, value: usdcIn, validAfter: 0n, validBefore: deadline, nonce } });
  const res = await post("/api/trade/relay", { kind: "buy", curve: S.curve, buyer: acct.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error);
  await wait(j.txHash);
}
await buy(creator, 6);
await buy(small, 3);
await chain.request({ method: "evm_mine", params: [] });

// Two freshly minted issues are proposed (the creator owns the character, so may propose).
const issuesAbi = parseAbi(["function mint(address to, bytes32 contentHash, bytes32 paymentTx, uint16 pages, uint256 remixOf) returns (uint256)", "event IssueMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed paymentTx, bytes32 contentHash, uint256 remixOf, uint16 pages)"]);
async function mintIssue() {
  const r = await wait(await relayer.writeContract({ chain: null, address: LP.komaIssues, abi: issuesAbi, functionName: "mint", args: [creator.address, keccak256(randomBytes(32)), keccak256(randomBytes(32)), 4, 0n] }));
  return Number(parseEventLogs({ abi: issuesAbi, eventName: "IssueMinted", logs: r.logs })[0].args.tokenId);
}
const [A, B] = [await mintIssue(), await mintIssue()];
for (const id of [A, B]) await wait(await relayer.writeContract({ chain: null, address: LP.canonRegistry, abi: canonAbi, functionName: "propose", args: [S.seriesId, BigInt(id), creator.address] }));
for (let i = 0; i < 30 && ((await getJson(`/api/canon/${S.seriesId}`)).proposals ?? []).length < 2; i++) await sleep(1000);

// Votes: the smaller holder backs A, the creator (bigger) backs B.
const vote = async (acct, issueId) =>
  post(`/api/canon/${S.seriesId}/vote`, {
    episode: 1,
    issueId,
    voter: acct.address,
    signature: await acct.signTypedData({ domain: { name: "KOMA Canon", version: "1", chainId, verifyingContract: LP.canonRegistry }, types: { Vote: [{ name: "seriesId", type: "uint256" }, { name: "episode", type: "uint256" }, { name: "issueId", type: "uint256" }, { name: "voter", type: "address" }] }, primaryType: "Vote", message: { seriesId: S.seriesId, episode: 1n, issueId: BigInt(issueId), voter: acct.address } }),
  });
const [va, vb] = [await vote(small, A), await vote(creator, B)];
check("C2", "two holders vote (signed, free) on two proposals", va.ok && vb.ok, `${va.status} ${vb.status}`);

// Let the window close. The keeper must leave it alone (CRE mode); /api/canon/due lists it with both signed votes.
console.log("     waiting for the 60 s voting window to close (real time)…");
await waitForWindow(chain, LP.canonRegistry, S.seriesId);
await sleep(6000);
const [, , finalizedEarly] = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "slot", args: [S.seriesId, 1n] });
const due = await getJson("/api/canon/due");
const listed = due.slots.find((s) => s.seriesId === Number(S.seriesId) && s.episode === 1);
check("C3", "window closed: the keeper waits for CRE; the due list carries the slot and its signed votes (no weights)", !finalizedEarly && listed?.votes.length === 2 && listed.votes.every((v) => v.weight === undefined), listed ? `${listed.votes.length} votes` : "not listed");

// The workflow's rules settle it through the forwarder.
const before = await chain.readContract({ address: S0, abi: settlerAbi, functionName: "settledCount" });
const run = settleViaCre(env.TEST_PAYTO_KEY);
const mine = run.settled.find((s) => s.seriesId === Number(S.seriesId) && s.episode === 1);
const winner = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "canonOf", args: [S.seriesId, 1n] });
const after = await chain.readContract({ address: S0, abi: settlerAbi, functionName: "settledCount" });
check("C4", "report delivered via MockKeystoneForwarder → CanonSettler → CanonRegistry.finalize; the bigger holder's pick wins", run.delivered && !!mine && Number(winner) === B && after > before, `tx ${run.tx?.slice(0, 12)}…, canonOf=${winner} (A=#${A}, B=#${B}), settled ${before}→${after}`);

// Same tallies and votes root the keeper would have produced (its formula, over the votes the app stored).
const db = new DatabaseSync(process.env.KOMA_DB ?? ".data/koma.db", { readOnly: true });
const stored = db.prepare("SELECT issue_id, voter, weight, signature FROM lp_votes WHERE series_id = ? AND episode = 1").all(Number(S.seriesId));
const keeperList = stored.map((v) => ({ issueId: v.issue_id, voter: v.voter.toLowerCase(), weight: v.weight, signature: v.signature })).sort((x, y) => (x.voter < y.voter ? -1 : 1));
const keeperRoot = keccak256(stringToBytes(JSON.stringify(keeperList)));
const logs = await chain.getContractEvents({ address: LP.canonRegistry, abi: canonAbi, eventName: "CanonFinalized", args: { seriesId: S.seriesId, episode: 1n }, fromBlock: BigInt(LP.deployBlock) });
const ev = logs.at(-1)?.args;
const total = stored.reduce((s, v) => s + BigInt(v.weight), 0n);
const bWeight = stored.filter((v) => v.issue_id === B).reduce((s, v) => s + BigInt(v.weight), 0n);
check("C5", "on-chain votes root and tallies equal the keeper's (weights re-read on chain match the app's)", ev?.votesRoot === keeperRoot && ev.totalVotes === total && ev.winnerVotes === bWeight, `root ${ev?.votesRoot?.slice(0, 10)}… ${ev?.votesRoot === keeperRoot ? "==" : "!="} keeper`);

// The app indexes Settled and shows it.
let view;
for (let i = 0; i < 30; i++) {
  view = await getJson(`/api/canon/${S.seriesId}`);
  if (view.canon?.[0]?.settledBy === "cre") break;
  await sleep(1000);
}
// The canon board renders client-side, so look at it in a real (headless) browser.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/s/${S.seriesId}`, { waitUntil: "networkidle" });
const badge = await page.getByText("Settled by Chainlink CRE").first().isVisible({ timeout: 15_000 }).catch(() => false);
await browser.close();
check("C6", "the series page shows the episode as settled by Chainlink CRE", view.canon?.[0]?.issueId === B && view.canon[0].settledBy === "cre" && badge, `settledBy ${view.canon?.[0]?.settledBy}, badge ${badge ? "visible" : "missing"}`);

// A second run has nothing left to do (replays are skipped on chain, never double-finalized).
const again = settleViaCre(env.TEST_PAYTO_KEY);
check("C7", "a second run finds nothing due for this slot", !again.batch?.some((b) => b.seriesId === Number(S.seriesId)), JSON.stringify(again.settled ?? []));

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
