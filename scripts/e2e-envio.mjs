// Envio HyperIndex end to end on the local fork: the indexer in indexer/ must agree with the chain and with KOMA's
// own event cache, pick up a new trade within seconds, and feed the /series leaderboard.
//   cd indexer && npm run db:up && npm run dev      (Postgres + Hasura on koma-envio-*; see indexer/README.md)
//   The app must run with ENVIO_GRAPHQL_URL=http://localhost:8093/v1/graphql.
//   node scripts/e2e-envio.mjs
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, stringToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AUSD_DOMAIN, setAusd } from "./lib/ausd.mjs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const BASE = process.env.KOMA_URL ?? "http://localhost:4320";
const GQL = process.env.ENVIO_GRAPHQL_URL ?? "http://localhost:8093/v1/graphql";
const RPC = env.NEXT_PUBLIC_MONAD_RPC_URL || "http://127.0.0.1:18643";
const chain = createPublicClient({ transport: http(RPC) });
const LP = JSON.parse(readFileSync(".data/addresses.local.json", "utf8"));
const db = new DatabaseSync(process.env.KOMA_DB ?? ".data/koma.db", { readOnly: true });
const chainId = await chain.getChainId();
const U = (n) => BigInt(Math.round(n * 1e6));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();
async function gql(query) {
  const r = await fetch(GQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}
const ALL = `{ _meta { isReady progressBlock } Stats { series trades volumeUsdc canonEpisodes backers }
  Series(order_by: { id: asc }) { id holders trades volumeUsdc canonEpisodes graduated } }`;

// Wait for the indexer to be live and caught up.
let head = await chain.getBlockNumber(), snap;
for (let i = 0; i < 40; i++) {
  snap = await gql(ALL).catch(() => null);
  if (snap?._meta[0]?.isReady && BigInt(snap._meta[0].progressBlock) >= head - 2n) break;
  await sleep(1500);
  head = await chain.getBlockNumber();
}
check("V1", "indexer synced to the chain head", !!snap?._meta[0]?.isReady && BigInt(snap._meta[0].progressBlock) >= head - 2n, snap ? `block ${snap._meta[0].progressBlock} / head ${head}` : "no response");

// Parity with KOMA's own index (SQLite, rebuilt from the same events by the app's keeper).
const app = (await getJson("/api/series")).series;
const local = db.prepare("SELECT series_id AS id, COUNT(*) AS n, SUM(CAST(usdc AS INTEGER)) AS v FROM lp_trades GROUP BY series_id").all();
const localBy = new Map(local.map((r) => [String(r.id), r]));
const appBy = new Map(app.map((s) => [String(s.id), s]));
const mism = [];
for (const s of snap.Series) {
  const a = appBy.get(s.id), l = localBy.get(s.id);
  if (!a) mism.push(`${s.id}: not in app`);
  else if (a.holders !== s.holders) mism.push(`${s.id}: holders ${s.holders} vs ${a.holders}`);
  if ((l?.n ?? 0) !== s.trades) mism.push(`${s.id}: trades ${s.trades} vs ${l?.n ?? 0}`);
  if (BigInt(l?.v ?? 0) !== BigInt(s.volumeUsdc)) mism.push(`${s.id}: volume ${s.volumeUsdc} vs ${l?.v ?? 0}`);
  if (a && a.graduated !== s.graduated) mism.push(`${s.id}: graduated ${s.graduated} vs ${a.graduated}`);
}
check("V2", "every series matches the app: holders, trades, volume, graduation", snap.Series.length === app.length && mism.length === 0, mism.slice(0, 4).join("; ") || `${app.length} series`);

const finalized = db.prepare("SELECT COUNT(*) AS n FROM lp_slots WHERE finalized = 1").get().n;
const g = snap.Stats[0];
const tradesTotal = local.reduce((a, r) => a + r.n, 0);
check("V3", "global stats: series, trades, canon episodes", g.series === app.length && g.trades === tradesTotal && g.canonEpisodes === finalized, `series ${g.series}/${app.length} trades ${g.trades}/${tradesTotal} canon ${g.canonEpisodes}/${finalized}`);

// A new gasless buy shows up in the indexer and on the board.
const buyer = privateKeyToAccount(env.TEST_AGENT_KEY);
const target = app.find((s) => !s.complete && !s.graduated);
if (!target) throw new Error("needs an open curve (run test:launchpad first)");
await setAusd(chain, buyer.address, U(20));
const curveAbi = parseAbi(["function quoteBuy(uint256) view returns (uint256,uint256,uint256)"]);
const usdcIn = U(3);
const [out] = await chain.readContract({ address: target.curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
const minCoinOut = (out * 99n) / 100n, deadline = BigInt(Math.floor(Date.now() / 1000) + 3600), salt = toHex(randomBytes(32));
const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(stringToBytes("KOMA_BUY_V1")), target.curve, buyer.address, usdcIn, minCoinOut, deadline, salt]));
const signature = await buyer.signTypedData({ domain: { ...AUSD_DOMAIN, chainId, verifyingContract: LP.usdc }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: buyer.address, to: target.curve, value: usdcIn, validAfter: 0n, validBefore: deadline, nonce } });
const before = await gql(`{ Stats { trades } Backer(where: { id: { _eq: "${buyer.address.toLowerCase()}" } }) { volumeUsdc trades } }`);
const res = await fetch(`${BASE}/api/trade/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "buy", curve: target.curve, buyer: buyer.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature }) });
const j = await res.json();
if (!res.ok) throw new Error(j.error);
const t0 = Date.now();
await chain.waitForTransactionReceipt({ hash: j.txHash });
let seen = null;
for (let i = 0; i < 40 && !seen; i++) {
  const r = await gql(`{ Trade(where: { tx: { _eq: "${j.txHash.toLowerCase()}" } }) { seriesId trader isBuy usdc venue } }`);
  seen = r.Trade.find((t) => t.isBuy && t.venue === "curve") ?? null;
  if (!seen) await sleep(500);
}
const after = await gql(`{ Stats { trades } Backer(where: { id: { _eq: "${buyer.address.toLowerCase()}" } }) { volumeUsdc trades } }`);
const grew = BigInt(after.Backer[0]?.volumeUsdc ?? 0) - BigInt(before.Backer[0]?.volumeUsdc ?? 0);
check("V4", "a new gasless buy is indexed: trade row, backer volume, global count", !!seen && seen.seriesId === String(target.id) && after.Stats[0].trades === before.Stats[0].trades + 1 && grew > 0n && grew <= usdcIn, seen ? `$${target.symbol} in ${((Date.now() - t0) / 1000).toFixed(1)}s, backer +${Number(grew) / 1e6} AUSD` : "not indexed");

// The board reads from Envio.
const board = await getJson("/api/board");
const top = (await gql(`{ Backer(limit: 1, order_by: [{ volumeUsdc: desc }, { id: asc }]) { id } }`)).Backer[0];
check("V5", "/api/board is served from Envio and matches it", board.source === "envio" && board.stats.trades === after.Stats[0].trades && board.topBackers[0]?.address === top.id, `source ${board.source}, ${board.stats.trades} trades, block ${board.indexedBlock}`);
const html = await (await fetch(`${BASE}/series`)).text();
check("V6", "/series renders the leaderboard with its Envio source", html.includes('data-board-source="envio"') && html.includes("Indexed by Envio HyperIndex"));

// Chainlink CRE settlements: the same slots marked settled by CRE in both indexes.
const creLocal = db.prepare("SELECT series_id || '-' || episode AS id FROM lp_slots WHERE settled_by = 'cre' ORDER BY id").all().map((r) => r.id);
const creEnvio = (await gql(`{ CanonEpisode(where: { settledBy: { _eq: "cre" } }, order_by: { id: asc }) { id } }`)).CanonEpisode.map((r) => r.id);
check("V7", "canon episodes settled by Chainlink CRE match the app's index", JSON.stringify(creLocal.sort()) === JSON.stringify(creEnvio.sort()), `${creEnvio.length} CRE-settled (${creEnvio.join(", ") || "none yet"})`);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
