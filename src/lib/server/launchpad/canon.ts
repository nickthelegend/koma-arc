import { formatUnits, parseUnits } from "viem";
import { CANON_THRESHOLD, canonAbi, characterAbi, coinAbi, voteTypes } from "@/lib/launchpad/abi";
import type { Addr } from "@/lib/launchpad/types";
import { config, publicClient } from "../config";
import { chainNow } from "./chain-time";
import { launchpad } from "./addresses";
import { db } from "./db";
import { seriesRow } from "./queries";
import { propose, reason } from "./relay";
import { nextIndex } from "./indexer";

const THRESHOLD = parseUnits(String(CANON_THRESHOLD), 18);

/**
 * Checked before quoting an episode, so nobody pays for a proposal the
 * registry would refuse: proposers need 1M coins (or to own the character).
 */
export async function canPropose(seriesId: number, proposer: Addr): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = launchpad();
  if (!a) return { ok: false, error: "The launchpad isn't deployed on this network yet." };
  const s = seriesRow(seriesId);
  if (!s) return { ok: false, error: `Series #${seriesId} doesn't exist.` };
  if (s.graduated || s.complete) {
    // Graduated series keep their canon going; nothing to block here.
  }
  const owner = await publicClient.readContract({ address: a.characterNft, abi: characterAbi, functionName: "ownerOf", args: [BigInt(s.character_id)] });
  if (owner.toLowerCase() === proposer.toLowerCase()) return { ok: true };
  const open = db().prepare("SELECT snapshot, ends_at FROM lp_slots WHERE series_id = ? AND finalized = 0").get(seriesId) as { snapshot: number; ends_at: number } | undefined;
  const votes = open
    ? await publicClient.readContract({ address: s.coin, abi: coinAbi, functionName: "getPastVotes", args: [proposer, BigInt(open.snapshot)] })
    : await publicClient.readContract({ address: s.coin, abi: coinAbi, functionName: "getVotes", args: [proposer] });
  if (votes < THRESHOLD) {
    const when = open ? "when this episode's voting opened" : "right now";
    return { ok: false, error: `Proposing needs ${CANON_THRESHOLD.toLocaleString("en-US")} $${s.symbol} ${when}; you had ${Number(formatUnits(votes, 18)).toLocaleString("en-US")}.` };
  }
  return { ok: true };
}

/** After an episode is minted: propose it now, or queue it until the next slot opens. */
export async function proposeOrQueue(seriesId: number, issueId: number, proposer: Addr, jobId: string) {
  try {
    await propose(seriesId, issueId, proposer);
    // Finish only once the canon board (served from the index) shows the proposal.
    await nextIndex();
    await nextIndex();
    return { proposed: true as const };
  } catch (e) {
    const why = reason(e);
    db().prepare(
      "INSERT INTO lp_pending_proposals (issue_id, series_id, proposer, job_id, attempts, error) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(issue_id) DO NOTHING",
    ).run(issueId, seriesId, proposer, jobId, why);
    return { proposed: false as const, error: why };
  }
}

export type VoteResult = { ok: true; weight: bigint } | { ok: false; status: number; error: string };

/**
 * Checks and records one signed canon vote (the HTTP route and the autopilot both use this): the slot must
 * be open, the issue a proposal for it, the EIP-712 signature the voter's, and the voter's snapshot weight > 0.
 * Voting again before the window closes replaces the earlier vote.
 */
export async function recordVote(seriesId: number, episode: number, issueId: number, voter: Addr, signature: `0x${string}`): Promise<VoteResult> {
  const a = launchpad();
  if (!a) return { ok: false, status: 503, error: "The launchpad isn't deployed on this network yet." };
  const d = db();
  const slot = d.prepare("SELECT ends_at, finalized FROM lp_slots WHERE series_id = ? AND episode = ?").get(seriesId, episode) as { ends_at: number; finalized: number } | undefined;
  if (!slot) return { ok: false, status: 409, error: "That episode isn't open for votes." };
  if (slot.finalized || (await chainNow()) >= slot.ends_at) return { ok: false, status: 409, error: "Voting on this episode has closed." };
  if (!d.prepare("SELECT 1 FROM lp_proposals WHERE series_id = ? AND episode = ? AND issue_id = ?").get(seriesId, episode, issueId)) {
    return { ok: false, status: 409, error: "That issue isn't a proposal for this episode." };
  }
  const valid = await publicClient.verifyTypedData({
    address: voter,
    domain: voteDomain(a.canonRegistry),
    types: voteTypes,
    primaryType: "Vote",
    message: { seriesId: BigInt(seriesId), episode: BigInt(episode), issueId: BigInt(issueId), voter },
    signature,
  });
  if (!valid) return { ok: false, status: 401, error: "Signature doesn't match the voter." };
  const weight = await publicClient.readContract({ address: a.canonRegistry, abi: canonAbi, functionName: "votingPower", args: [BigInt(seriesId), BigInt(episode), voter] });
  if (weight === BigInt(0)) return { ok: false, status: 403, error: "You held no coins of this series when voting opened, so this vote would weigh nothing." };
  d.prepare(
    `INSERT INTO lp_votes (series_id, episode, voter, issue_id, weight, signature, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(series_id, episode, voter) DO UPDATE SET issue_id = excluded.issue_id, weight = excluded.weight, signature = excluded.signature, at = excluded.at`,
  ).run(seriesId, episode, voter.toLowerCase(), issueId, String(weight), signature, Math.floor(Date.now() / 1000));
  return { ok: true, weight };
}

/** The EIP-712 domain canon votes are signed under. */
export const voteDomain = (canonRegistry: Addr) => ({ name: "KOMA Canon", version: "1", chainId: config.network.chain.id, verifyingContract: canonRegistry });
