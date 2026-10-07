import { NextResponse, type NextRequest } from "next/server";
import { erc20Abi, parseAbi } from "viem";
import { config, publicClient, serverWallet } from "@/lib/server/config";
import { faucetUsage, recordFaucetClaim } from "@/lib/server/store";
import { clientIp } from "@/lib/server/client-ip";

export const dynamic = "force-dynamic";

// Test AUSD on Monad testnet, from Agora's own faucet contract. KOMA's server calls
// requestFunds(user) and pays the MON gas, so a new wallet needs nothing but an address.
// Per-address and per-IP limits keep one visitor from draining the AI budget.
const DAY = 24 * 60 * 60 * 1000;
const PER_ADDRESS = Number(process.env.KOMA_FAUCET_PER_ADDRESS ?? 1);
const PER_IP = Number(process.env.KOMA_FAUCET_PER_IP ?? 3);
const PER_DAY = Number(process.env.KOMA_FAUCET_PER_DAY ?? 100);
const faucetAbi = parseAbi(["function requestFunds(address recipient)"]);

export async function POST(req: NextRequest) {
  const faucet = config.network.ausdFaucet;
  if (!config.network.faucet || !faucet) return NextResponse.json({ error: "No faucet on this network." }, { status: 404 });
  if (!serverWallet) return NextResponse.json({ error: "The faucet isn't configured on this server." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  const address = body?.address;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "Send a wallet address." }, { status: 400 });
  const ip = clientIp(req);

  const used = await faucetUsage(address, ip, Date.now() - DAY);
  if (used.total >= PER_DAY) return NextResponse.json({ error: "The faucet is dry for today. Try again tomorrow." }, { status: 429 });
  if (used.address >= PER_ADDRESS || used.ip >= PER_IP) {
    return NextResponse.json({ error: "You've already had today's test AUSD. Come back tomorrow." }, { status: 429 });
  }

  const usdc = config.network.usdc;
  const who = address as `0x${string}`;
  const before = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  try {
    const { request } = await publicClient.simulateContract({ account: serverWallet.account, address: faucet, abi: faucetAbi, functionName: "requestFunds", args: [who] });
    // Monad charges the gas limit, not gas used, so keep the headroom small.
    const gas = await publicClient.estimateContractGas({ account: serverWallet.account, address: faucet, abi: faucetAbi, functionName: "requestFunds", args: [who] });
    const hash = await serverWallet.writeContract({ ...request, gas: (gas * BigInt(11)) / BigInt(10) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status !== "success") throw new Error("reverted");
  } catch (e) {
    const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
    // Agora's faucet has a 60 s global cooldown shared by everyone.
    const busy = /cooldown|too soon|wait/i.test(msg);
    return NextResponse.json({ error: busy ? "Agora's faucet is cooling down. Try again in a minute." : "The AUSD faucet didn't pay out. Try again shortly." }, { status: busy ? 429 : 502 });
  }
  const after = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  if (after <= before) return NextResponse.json({ error: "The faucet didn't pay out. Try again shortly." }, { status: 502 });
  await recordFaucetClaim(address, ip, Number(after - before));
  return NextResponse.json({ ok: true, received: Number(after - before) / 1e6, balance: Number(after) / 1e6 });
}
