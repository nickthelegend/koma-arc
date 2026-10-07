import { readFileSync } from "node:fs";
import type { LaunchpadAddresses } from "@/lib/launchpad/types";
import { config, deploymentFile } from "../config";

/**
 * Launchpad contract addresses written by contracts/script/DeployLaunchpad.s.sol
 * to deployments/<network>.json (arc-testnet.json, arc-mainnet.json).
 * KOMA_LAUNCHPAD_ADDRESSES points elsewhere. Read once, lazily; null when the
 * launchpad isn't deployed on this network.
 */
let cached: LaunchpadAddresses | null | undefined;

export function launchpad(): LaunchpadAddresses | null {
  if (cached !== undefined) return cached;
  const file = deploymentFile();
  try {
    const a = JSON.parse(readFileSync(file, "utf8")) as LaunchpadAddresses;
    cached = a.chainId === config.network.chain.id && a.seriesFactory ? a : null;
    if (!cached) console.warn(`[koma] ${file} is for chain ${a.chainId}, not ${config.network.chain.id}; launchpad off`);
  } catch {
    cached = null;
  }
  return cached;
}

export function requireLaunchpad(): LaunchpadAddresses {
  const a = launchpad();
  if (!a) throw new Error("The launchpad isn't deployed on this network yet.");
  return a;
}
