// USDC on Arc, shared by the e2e suites. Arc's USDC is the gas token: the ERC-20 at 0x3600…0000 (6 decimals) and
// the native balance (18 decimals) are one balance. There is no faucet contract to call from a script: test wallets
// are funded once by scripts/testnet-setup.sh (from the deployer, which drips from https://faucet.circle.com).
import { parseAbi } from "viem";

export const USDC = "0x3600000000000000000000000000000000000000";
/** USDC's EIP-712 domain on Arc (name() "USDC", version() "2"). */
export const USDC_DOMAIN = { name: "USDC", version: "2" };
export const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

/** Throws early with a clear message when a test wallet can't afford its part of a suite. */
export async function requireUsdc(chain, who, amount, label = who) {
  const have = await chain.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [who] });
  if (have < amount) {
    throw new Error(`${label} holds ${Number(have) / 1e6} USDC on Arc testnet; this suite needs ${Number(amount) / 1e6}. Run \`sh scripts/testnet-setup.sh\`.`);
  }
  return have;
}

/**
 * True when `who` paid no gas between two snapshots: on Arc the native balance (18 decimals) is the same USDC, so
 * a wallet that only signed moves its native balance by exactly its ERC-20 USDC delta × 10^12.
 */
export const paidNoGas = (nativeBefore, nativeAfter, usdcBefore, usdcAfter) => nativeBefore - nativeAfter === (usdcBefore - usdcAfter) * BigInt(1e12);

export function readEnv(file = process.env.KOMA_ENV_FILE ?? ".env.local") {
  const { readFileSync } = process.getBuiltinModule("node:fs");
  return Object.fromEntries(
    readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}
