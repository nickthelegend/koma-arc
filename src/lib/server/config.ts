import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, nonceManager, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KOMA, RPC_URL } from "@/lib/network";

/** The deploy script's output for this network (contracts/script/DeployLaunchpad.s.sol). */
export const deploymentFile = () =>
  process.env.KOMA_LAUNCHPAD_ADDRESSES || path.join(process.cwd(), "deployments", `${KOMA.testnet ? "arc-testnet" : "arc-mainnet"}.json`);

/** KomaIssues from KOMA_CONTRACT, else from the deployment file. */
function issuesContract(): string | undefined {
  if (process.env.KOMA_CONTRACT) return process.env.KOMA_CONTRACT;
  try {
    const d = JSON.parse(readFileSync(deploymentFile(), "utf8")) as { chainId?: number; komaIssues?: string };
    return d.chainId === KOMA.chain.id ? d.komaIssues : undefined;
  } catch {
    return undefined;
  }
}

/** Everything the server needs from the environment, checked in one place. */
function read() {
  const key = process.env.SERVER_PRIVATE_KEY as `0x${string}` | undefined;
  const account = key ? privateKeyToAccount(key, { nonceManager }) : null;
  const contract = issuesContract();
  const missing = [
    !key && "SERVER_PRIVATE_KEY",
    !contract && "KOMA_CONTRACT (or a deployments/ file)",
  ].filter(Boolean) as string[];

  return {
    network: KOMA,
    // The server talks to the chain directly; browsers go through /api/rpc.
    rpcUrl: process.env.KOMA_SERVER_RPC_URL || RPC_URL,
    account,
    payTo: (process.env.KOMA_PAY_TO || account?.address) as `0x${string}` | undefined,
    contract: contract as `0x${string}` | undefined,
    falKey: process.env.FAL_KEY,
    dataDir: process.env.KOMA_DATA_DIR || (process.env.VERCEL ? "/tmp/koma-cache" : path.join(process.cwd(), ".data")),
    publicUrl: process.env.KOMA_PUBLIC_URL || "http://localhost:4310",
    missing,
  };
}

export const config = read();

export const publicClient = createPublicClient({ chain: KOMA.chain, transport: http(config.rpcUrl) });

/**
 * Log scans for the indexer. Defaults to the main RPC; set KOMA_LOGS_RPC_URL when the main provider caps
 * eth_getLogs ranges (Alchemy's free tier allows 10 blocks), e.g. an archive endpoint for logs only.
 */
export const logsClient = process.env.KOMA_LOGS_RPC_URL ? createPublicClient({ chain: KOMA.chain, transport: http(process.env.KOMA_LOGS_RPC_URL) }) : publicClient;

/** Raw JSON-RPC to the chain, for node methods viem has no action for. */
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(config.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

/** One key pays facilitator gas and mints issues; the nonce manager keeps its txs in order. */
export const serverWallet = config.account
  ? createWalletClient({ account: config.account, chain: KOMA.chain, transport: http(config.rpcUrl) }).extend(publicActions)
  : null;

export class NotConfiguredError extends Error {
  constructor() {
    super(`KOMA server is missing ${config.missing.join(", ")}. See .env.example.`);
  }
}

export function assertConfigured() {
  if (config.missing.length) throw new NotConfiguredError();
}
