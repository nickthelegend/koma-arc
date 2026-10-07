import { randomBytes } from "node:crypto";
import { toHex, verifyMessage } from "viem";
import { curveAbi, voteTypes } from "@/lib/launchpad/abi";
import { buyNonce, withSlippage } from "@/lib/launchpad/intents";
import type { Addr } from "@/lib/launchpad/types";
import { GASLESS_MIN_USDC, USDC_DOMAIN } from "@/lib/network";
import { config, publicClient } from "../config";
import { launchpad } from "../launchpad/addresses";
import { recordVote, voteDomain } from "../launchpad/canon";
import { chainNow } from "../launchpad/chain-time";
import { db } from "../launchpad/db";
import { seriesRow } from "../launchpad/queries";
import { reason, relayBuy } from "../launchpad/relay";
import type { AutopilotPolicy } from "./policy";
import { createPolicy, signFor, signerId, signerMode, walletMatches } from "./signer";

/**
 * Backer autopilot: a backer lets KOMA act for them on one series while they're away — vote in every
 * canon round with their coins, and/or buy a fixed amount of the coin each time a new episode becomes
 * canon. The authority is a Privy session signer limited by a policy (see policy.ts / signer.ts).
 */
export const MAX_AUTOBUY_USD = 25;

export type Enrollment = {
  address: Addr;
  seriesId: number;
  walletId: string | null;
  vote: boolean;
  buyUsd: number;
  policyId: string;
  enrolledAt: number;
};
export type AutopilotAction = { kind: "vote" | "buy"; episode: number; detail: string; tx: string | null; at: number; error: string | null };

function tables() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS ap_enrollments (
      address TEXT NOT NULL, series_id INTEGER NOT NULL, wallet_id TEXT, vote INTEGER NOT NULL, buy_usd REAL NOT NULL,
      policy_id TEXT NOT NULL, enrolled_at INTEGER NOT NULL, PRIMARY KEY (address, series_id));
    CREATE TABLE IF NOT EXISTS ap_actions (
      address TEXT NOT NULL, series_id INTEGER NOT NULL, episode INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL,
      tx TEXT, error TEXT, at INTEGER NOT NULL, PRIMARY KEY (address, series_id, episode, kind));`);
  return d;
}

type EnrollRow = { address: Addr; series_id: number; wallet_id: string | null; vote: number; buy_usd: number; policy_id: string; enrolled_at: number };
const fromRow = (r: EnrollRow): Enrollment => ({ address: r.address, seriesId: r.series_id, walletId: r.wallet_id, vote: !!r.vote, buyUsd: r.buy_usd, policyId: r.policy_id, enrolledAt: r.enrolled_at });

/** The message a backer signs to change their autopilot (so nobody can enroll someone else's wallet). */
export function enrollMessage(o: { address: string; seriesId: number; vote: boolean; buyUsd: number; issuedAt: number }) {
  return `KOMA autopilot\nwallet: ${o.address.toLowerCase()}\nseries: ${o.seriesId}\nvote: ${o.vote ? "yes" : "no"}\nauto-buy: $${o.buyUsd}\nissued: ${o.issuedAt}`;
}

export function policyFor(seriesId: number, vote: boolean, buyUsd: number): AutopilotPolicy | null {
  const a = launchpad();
  const s = seriesRow(seriesId);
  if (!a || !s) return null;
  return { chainId: config.network.chain.id, canonRegistry: a.canonRegistry, ausd: a.usdc, curve: s.curve, vote, maxBuy: BigInt(Math.round(buyUsd * 1e6)) };
}

export function getEnrollment(address: string, seriesId: number): Enrollment | null {
  const r = tables().prepare("SELECT * FROM ap_enrollments WHERE address = ? AND series_id = ?").get(address.toLowerCase(), seriesId) as EnrollRow | undefined;
  return r ? fromRow(r) : null;
}

export function actionsFor(address: string, seriesId: number): AutopilotAction[] {
  return tables()
    .prepare("SELECT kind, episode, detail, tx, at, error FROM ap_actions WHERE address = ? AND series_id = ? ORDER BY at DESC LIMIT 20")
    .all(address.toLowerCase(), seriesId) as AutopilotAction[];
}

export async function enroll(o: {
  address: Addr;
  seriesId: number;
  vote: boolean;
  buyUsd: number;
  walletId: string | null;
  issuedAt: number;
  signature: `0x${string}`;
}): Promise<{ ok: true; enrollment: Enrollment; signerId: string; mode: string } | { ok: false; status: number; error: string }> {
  if (signerMode() === "off") return { ok: false, status: 503, error: "Autopilot isn't configured on this server (Privy session signer missing)." };
  if (Math.abs(Date.now() / 1000 - o.issuedAt) > 600) return { ok: false, status: 400, error: "That request is stale. Sign again." };
  if (o.buyUsd !== 0 && (o.buyUsd < GASLESS_MIN_USDC || o.buyUsd > MAX_AUTOBUY_USD)) {
    return { ok: false, status: 400, error: `Auto-buy is $${GASLESS_MIN_USDC} to $${MAX_AUTOBUY_USD} per episode, or off.` };
  }
  if (!o.vote && o.buyUsd === 0) return { ok: false, status: 400, error: "Turn on voting or auto-buy (or switch the autopilot off)." };
  const ok = await verifyMessage({ address: o.address, message: enrollMessage(o), signature: o.signature }).catch(() => false);
  if (!ok) return { ok: false, status: 401, error: "Signature doesn't match the wallet." };
  const policy = policyFor(o.seriesId, o.vote, o.buyUsd);
  if (!policy) return { ok: false, status: 404, error: "No such series." };
  if (!(await walletMatches(o.walletId ?? "", o.address))) return { ok: false, status: 403, error: "That embedded wallet doesn't belong to this address." };
  const policyId = await createPolicy(policy, `KOMA autopilot ${o.address.slice(0, 8)} series ${o.seriesId}`);
  const enrolledAt = await chainNow();
  tables()
    .prepare(
      `INSERT INTO ap_enrollments (address, series_id, wallet_id, vote, buy_usd, policy_id, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address, series_id) DO UPDATE SET wallet_id = excluded.wallet_id, vote = excluded.vote, buy_usd = excluded.buy_usd, policy_id = excluded.policy_id`,
    )
    .run(o.address.toLowerCase(), o.seriesId, o.walletId, o.vote ? 1 : 0, o.buyUsd, policyId, enrolledAt);
  return { ok: true, enrollment: getEnrollment(o.address, o.seriesId)!, signerId: signerId(), mode: signerMode() };
}

export async function unenroll(o: { address: Addr; seriesId: number; issuedAt: number; signature: `0x${string}` }) {
  const msg = enrollMessage({ ...o, vote: false, buyUsd: 0 });
  if (Math.abs(Date.now() / 1000 - o.issuedAt) > 600) return { ok: false as const, status: 400, error: "That request is stale. Sign again." };
  if (!(await verifyMessage({ address: o.address, message: msg, signature: o.signature }).catch(() => false))) {
    return { ok: false as const, status: 401, error: "Signature doesn't match the wallet." };
  }
  tables().prepare("DELETE FROM ap_enrollments WHERE address = ? AND series_id = ?").run(o.address.toLowerCase(), o.seriesId);
  return { ok: true as const };
}

function logAction(e: Enrollment, episode: number, kind: "vote" | "buy", detail: string, tx: string | null, error: string | null) {
  tables()
    .prepare(
      `INSERT INTO ap_actions (address, series_id, episode, kind, detail, tx, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address, series_id, episode, kind) DO UPDATE SET detail = excluded.detail, tx = excluded.tx, error = excluded.error, at = excluded.at`,
    )
    .run(e.address, e.seriesId, episode, kind, detail, tx, error, Math.floor(Date.now() / 1000));
}

/** One keeper pass: cast due votes and make due buys for every enrolled backer. Runs after each index tick. */
export async function runAutopilot() {
  const a = launchpad();
  if (!a || signerMode() === "off") return;
  const d = tables();
  const now = await chainNow();
  const enrollments = (d.prepare("SELECT * FROM ap_enrollments").all() as EnrollRow[]).map(fromRow);
  for (const e of enrollments) {
    const series = seriesRow(e.seriesId);
    const policy = policyFor(e.seriesId, e.vote, e.buyUsd);
    if (!series || !policy) continue;
    const who = { address: e.address, walletId: e.walletId, policy };

    if (e.vote) {
      const open = d.prepare("SELECT episode FROM lp_slots WHERE series_id = ? AND finalized = 0 AND ends_at > ?").get(e.seriesId, now + 2) as { episode: number } | undefined;
      const done = open && d.prepare("SELECT 1 FROM ap_actions WHERE address = ? AND series_id = ? AND episode = ? AND kind = 'vote' AND error IS NULL").get(e.address, e.seriesId, open.episode);
      const votedByHand = open && d.prepare("SELECT 1 FROM lp_votes WHERE series_id = ? AND episode = ? AND voter = ?").get(e.seriesId, open.episode, e.address);
      if (open && !done && !votedByHand) {
        // Back the character owner's own proposal when there is one, else the earliest.
        const props = d.prepare("SELECT issue_id, proposer FROM lp_proposals WHERE series_id = ? AND episode = ? ORDER BY at, issue_id").all(e.seriesId, open.episode) as { issue_id: number; proposer: string }[];
        const pick = props.find((p) => p.proposer.toLowerCase() === series.creator.toLowerCase()) ?? props[0];
        if (pick) {
          try {
            const message = { seriesId: BigInt(e.seriesId), episode: BigInt(open.episode), issueId: BigInt(pick.issue_id), voter: e.address };
            const signature = await signFor(who, { domain: voteDomain(a.canonRegistry), types: voteTypes as never, primaryType: "Vote", message });
            const r = await recordVote(e.seriesId, open.episode, pick.issue_id, e.address, signature);
            logAction(e, open.episode, "vote", `voted for issue #${pick.issue_id}`, null, r.ok ? null : r.error);
          } catch (err) {
            logAction(e, open.episode, "vote", `vote for issue #${pick.issue_id}`, null, reason(err));
          }
        }
      }
    }

    if (e.buyUsd > 0 && !series.complete) {
      // Each episode that became canon after the backer enrolled triggers one buy.
      const due = d
        .prepare(
          `SELECT s.episode FROM lp_slots s WHERE s.series_id = ? AND s.finalized = 1 AND s.ends_at > ?
           AND NOT EXISTS (SELECT 1 FROM ap_actions x WHERE x.address = ? AND x.series_id = s.series_id AND x.episode = s.episode AND x.kind = 'buy')
           ORDER BY s.episode`,
        )
        .all(e.seriesId, e.enrolledAt, e.address) as { episode: number }[];
      for (const { episode } of due) {
        try {
          const tx = await autoBuy(e, policy, series.curve);
          logAction(e, episode, "buy", `bought $${e.buyUsd} of $${series.symbol.trim()} for canon episode ${episode}`, tx, null);
        } catch (err) {
          logAction(e, episode, "buy", `buy $${e.buyUsd} for canon episode ${episode}`, null, reason(err));
        }
      }
    }
  }
}

async function autoBuy(e: Enrollment, policy: AutopilotPolicy, curve: Addr) {
  const usdcIn = BigInt(Math.round(e.buyUsd * 1e6));
  const [out] = await publicClient.readContract({ address: curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
  const minCoinOut = withSlippage(out, 100);
  const deadline = BigInt((await chainNow()) + 600);
  const salt = toHex(randomBytes(32));
  const nonce = buyNonce({ curve, buyer: e.address, usdcIn, minCoinOut, deadline, salt });
  const types = {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const signature = await signFor(
    { address: e.address, walletId: e.walletId, policy },
    {
      domain: { ...USDC_DOMAIN, chainId: config.network.chain.id, verifyingContract: policy.ausd },
      types,
      primaryType: "ReceiveWithAuthorization",
      message: { from: e.address, to: curve, value: usdcIn, validAfter: BigInt(0), validBefore: deadline, nonce },
    },
  );
  return relayBuy({
    curve,
    buyer: e.address,
    usdcIn: usdcIn.toString(),
    minCoinOut: minCoinOut.toString(),
    deadline: deadline.toString(),
    salt,
    validAfter: "0",
    validBefore: deadline.toString(),
    signature,
  });
}
