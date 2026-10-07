// Backer autopilot (Privy session signer + policy) end to end on the local fork:
// enroll with a signature, then the keeper votes for the backer when a canon round opens and buys for them
// when the episode becomes canon — each signature checked against the policy first.
//   Needs the app configured with Privy (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY, PRIVY_SIGNER_ID) and a
//   backer whose Privy embedded wallet has added KOMA's signer. Without them every check is reported UNTESTED.
//   node scripts/e2e-autopilot.mjs
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi, parseEventLogs, stringToBytes, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { creSettles, settleViaCre, waitForWindow } from "./lib/cre.mjs";
import { AUSD_DOMAIN, setAusd } from "./lib/ausd.mjs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const RPC = env.NEXT_PUBLIC_MONAD_RPC_URL || "http://127.0.0.1:18643";
const chain = createPublicClient({ transport: http(RPC) });
const LP = JSON.parse(readFileSync(".data/addresses.local.json", "utf8"));
const chainId = await chain.getChainId();
const relayer = createWalletClient({ account: privateKeyToAccount(env.SERVER_PRIVATE_KEY), transport: http(RPC) });
const backer = privateKeyToAccount(env.TEST_AGENT_KEY);
const U = (n) => BigInt(Math.round(n * 1e6));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();
const send = (method, path, body) => fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const message = (o) => `KOMA autopilot\nwallet: ${o.address.toLowerCase()}\nseries: ${o.seriesId}\nvote: ${o.vote ? "yes" : "no"}\nauto-buy: $${o.buyUsd}\nissued: ${o.issuedAt}`;
const enrollBody = async (acct, o, signer = acct) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  return { ...o, address: acct.address, issuedAt, signature: await signer.signMessage({ message: message({ ...o, address: acct.address, issuedAt }) }) };
};

const status = await getJson(`/api/autopilot`);
if (status.mode !== "privy") {
  console.log("UNTESTED P1–P6 autopilot: the app has no Privy session signer (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY, PRIVY_SIGNER_ID)");
  const off = await send("POST", "/api/autopilot", await enrollBody(backer, { seriesId: 1, vote: true, buyUsd: 3 }));
  check("P0", "without Privy the autopilot is honestly off: status mode \"off\", enrollment refused with 503", status.mode === "off" && off.status === 503, `mode ${status.mode}, enroll ${off.status}`);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed (P1–P6 untested)`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
check("P1", "autopilot signer configured (Privy)", status.mode === "privy", JSON.stringify(status));

// A fresh series with a 60 s canon window, created by the backer (so the backer's own proposal is the pick).
const factoryAbi = parseAbi([
  "struct LaunchParams { address creator; string name; string symbol; string characterName; bytes32 sheetHash; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; }",
  "function launch(LaunchParams p) returns (uint256)",
  "event SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)",
]);
const hash = await relayer.writeContract({ chain: null, address: LP.seriesFactory, abi: factoryAbi, functionName: "launch", args: [{ creator: backer.address, name: "Autopilot Check", symbol: "AUTO", characterName: "Pilot", sheetHash: keccak256(stringToBytes("autopilot")), parentSeriesId: 0n, graduationTarget: U(25), votingWindow: 60n }] });
const [launched] = parseEventLogs({ abi: factoryAbi, eventName: "SeriesLaunched", logs: (await chain.waitForTransactionReceipt({ hash })).logs });
const S = launched.args;
for (let i = 0; i < 30 && !(await fetch(`${BASE}/api/series/${S.seriesId}`)).ok; i++) await sleep(1000);

// The backer buys first (voting weight), gaslessly, like any holder.
await setAusd(chain, backer.address, U(50));
const curveAbi = parseAbi(["function quoteBuy(uint256) view returns (uint256,uint256,uint256)"]);
async function buy(acct, curve, n) {
  const usdcIn = U(n);
  const [out] = await chain.readContract({ address: curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
  const minCoinOut = (out * 99n) / 100n, deadline = BigInt(Math.floor(Date.now() / 1000) + 3600), salt = toHex(randomBytes(32));
  const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(stringToBytes("KOMA_BUY_V1")), curve, acct.address, usdcIn, minCoinOut, deadline, salt]));
  const signature = await acct.signTypedData({ domain: { ...AUSD_DOMAIN, chainId, verifyingContract: LP.usdc }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: acct.address, to: curve, value: usdcIn, validAfter: 0n, validBefore: deadline, nonce } });
  const res = await send("POST", "/api/trade/relay", { kind: "buy", curve, buyer: acct.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error);
  await chain.waitForTransactionReceipt({ hash: j.txHash });
}
await buy(backer, S.curve, 5);

// Bad enrollments are refused.
const stranger = privateKeyToAccount(generatePrivateKey());
const forged = await send("POST", "/api/autopilot", await enrollBody(backer, { seriesId: Number(S.seriesId), vote: true, buyUsd: 3 }, stranger));
const tooSmall = await send("POST", "/api/autopilot", await enrollBody(backer, { seriesId: Number(S.seriesId), vote: true, buyUsd: 2 }));
const tooBig = await send("POST", "/api/autopilot", await enrollBody(backer, { seriesId: Number(S.seriesId), vote: true, buyUsd: 100 }));
check("P2", "enrollment signed by someone else → 401; auto-buy under $3 or over the cap → 400", forged.status === 401 && tooSmall.status === 400 && tooBig.status === 400, `${forged.status} ${tooSmall.status} ${tooBig.status}`);

const ok = await send("POST", "/api/autopilot", await enrollBody(backer, { seriesId: Number(S.seriesId), vote: true, buyUsd: 3 }));
const okBody = await ok.json();
check("P3", "backer enrolls: vote yes, auto-buy $3 per canon episode; a policy is created for the session signer", ok.ok && !!okBody.enrollment?.policyId, okBody.enrollment?.policyId ?? okBody.error);

// A canon round opens: the relayer proposes an existing minted issue with the backer as proposer.
const comics = (await getJson("/api/comics")).comics;
const canonAbi = parseAbi(["function propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256)", "function seriesOfIssue(uint256) view returns (uint256,uint256,address)", "function canonOf(uint256,uint256) view returns (uint256)"]);
let pick;
for (const c of comics) {
  const [taken] = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "seriesOfIssue", args: [BigInt(c.chain.tokenId)] });
  if (taken === 0n) { pick = c.chain.tokenId; break; }
}
if (!pick) throw new Error("needs a minted issue that was never proposed (run test:api first)");
await chain.waitForTransactionReceipt({ hash: await relayer.writeContract({ chain: null, address: LP.canonRegistry, abi: canonAbi, functionName: "propose", args: [S.seriesId, BigInt(pick), backer.address] }) });

let view;
for (let i = 0; i < 40; i++) {
  const ap = await getJson(`/api/autopilot?address=${backer.address}&seriesId=${S.seriesId}`);
  view = ap.actions?.find((a) => a.kind === "vote");
  if (view) break;
  await sleep(1500);
}
const canon = await getJson(`/api/canon/${S.seriesId}`);
const counted = (canon.proposals ?? []).some((p) => Number(p.votes ?? 0) > 0);
check("P4", "the keeper votes for the backer when the round opens (signed under the policy, counted at snapshot weight)", !!view && !view.error && counted, view ? `${view.detail}${view.error ? ` (${view.error})` : ""}; tally ${counted ? "counted" : "empty"}` : "no vote");

// Let the window close and have it finalized (the keeper, or CRE in cre mode); the episode becomes canon → autopilot buys $3.
console.log("     waiting for the 60 s voting window to close (real time)…");
await waitForWindow(chain, LP.canonRegistry, S.seriesId);
if (await creSettles(BASE)) settleViaCre(env.TEST_PAYTO_KEY); // Chainlink CRE settles in cre mode (scripts/lib/cre.mjs)
let buyAction;
for (let i = 0; i < 60; i++) {
  const ap = await getJson(`/api/autopilot?address=${backer.address}&seriesId=${S.seriesId}`);
  buyAction = ap.actions?.find((a) => a.kind === "buy");
  if (buyAction) break;
  await sleep(1500);
}
const won = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "canonOf", args: [S.seriesId, 1n] });
check("P5", "episode finalized on chain → the keeper buys $3 for the backer, gasless, within the policy cap", Number(won) === pick && !!buyAction?.tx && !buyAction.error, buyAction ? `${buyAction.detail} ${buyAction.tx ?? buyAction.error}` : "no buy");

const off = await send("DELETE", "/api/autopilot", await (async () => {
  const issuedAt = Math.floor(Date.now() / 1000);
  return { address: backer.address, seriesId: Number(S.seriesId), issuedAt, signature: await backer.signMessage({ message: message({ address: backer.address, seriesId: Number(S.seriesId), vote: false, buyUsd: 0, issuedAt }) }) };
})());
const after = await getJson(`/api/autopilot?address=${backer.address}&seriesId=${S.seriesId}`);
check("P6", "backer switches it off with a signature", off.ok && !after.enrollment, `${off.status}`);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
