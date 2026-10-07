// L13: a character's USDC leaves Arc over Circle's CCTP V2 with the Forwarding Service, the way the series page's
// "Send it to another chain" button does it: the Character NFT's owner sends one transaction to the character's
// ERC-6551 wallet, which approves TokenMessengerV2 and burns with the forwarding hook in a batch. Circle attests and
// mints on Base Sepolia; the owner never touches Base.
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDC, erc20 } from "./usdc.mjs";

const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"; // Arc testnet, domain 26
const IRIS = "https://iris-api-sandbox.circle.com";
const BASE_SEPOLIA = { domain: 6, rpc: process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const FORWARD_HOOK = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const tba = parseAbi(["function executeBatch((address to, uint256 value, bytes data, uint8 operation)[] operations) payable returns (bytes[])"]);
const messenger = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);
const approveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function cctpL13({ chain, env, S, check, usdc, U, fmtU }) {
  const owner = privateKeyToAccount(env.TEST_BROWSER_KEY);
  const wallet = createWalletClient({ account: owner, chain: { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [chain.transport.url] } } }, transport: http(chain.transport.url) });
  // Top the character's wallet up with a 0.25 USDC tip so it clears Circle's forwarding fee (~0.054 USDC to Base).
  const tip = await wallet.writeContract({ address: USDC, abi: erc20, functionName: "transfer", args: [S.characterAccount, U(0.25)] });
  await chain.waitForTransactionReceipt({ hash: tip });
  const amount = await usdc(S.characterAccount);
  const fees = await (await fetch(`${IRIS}/v2/burn/USDC/fees/26/${BASE_SEPOLIA.domain}?forward=true`)).json();
  const row = fees.find((f) => f.finalityThreshold === 2000) ?? fees[0];
  const maxFee = (BigInt(row.forwardFee.med) * BigInt(110)) / BigInt(100) + (amount * BigInt(Math.round(row.minimumFee * 100))) / BigInt(1_000_000);
  const recipient = owner.address;
  const base = createPublicClient({ transport: http(BASE_SEPOLIA.rpc) });
  const baseBefore = await base.readContract({ address: BASE_SEPOLIA.usdc, abi: erc20, functionName: "balanceOf", args: [recipient] });

  const burnTx = await wallet.writeContract({
    address: S.characterAccount,
    abi: tba,
    functionName: "executeBatch",
    args: [[
      { to: USDC, value: BigInt(0), data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [TOKEN_MESSENGER, amount] }), operation: 0 },
      {
        to: TOKEN_MESSENGER,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: messenger,
          functionName: "depositForBurnWithHook",
          args: [amount, BASE_SEPOLIA.domain, `0x${recipient.slice(2).toLowerCase().padStart(64, "0")}`, USDC, `0x${"0".repeat(64)}`, maxFee, 2000, FORWARD_HOOK],
        }),
        operation: 0,
      },
    ]],
  });
  const receipt = await chain.waitForTransactionReceipt({ hash: burnTx });
  const left = await usdc(S.characterAccount);
  check("L13a", "character wallet burns its USDC on Arc via CCTP (one owner tx: ERC-6551 executeBatch approve + depositForBurnWithHook)", receipt.status === "success" && left === BigInt(0), `${fmtU(amount)} USDC burned, max fee ${fmtU(maxFee)}, tx ${burnTx}`);

  // Circle attests the burn and its Forwarding Service mints on Base Sepolia.
  let msg = null;
  const end = Date.now() + Number(process.env.CCTP_WAIT_MS ?? 600_000);
  while (Date.now() < end) {
    const res = await fetch(`${IRIS}/v2/messages/26?transactionHash=${burnTx}`);
    if (res.ok) {
      msg = (await res.json()).messages?.[0] ?? null;
      if (msg?.forwardTxHash) break;
    }
    await sleep(5000);
  }
  let minted = BigInt(0);
  if (msg?.forwardTxHash) {
    await base.waitForTransactionReceipt({ hash: msg.forwardTxHash, timeout: 60_000 }).catch(() => null);
    minted = (await base.readContract({ address: BASE_SEPOLIA.usdc, abi: erc20, functionName: "balanceOf", args: [recipient] })) - baseBefore;
  }
  check(
    "L13b",
    "Circle attests and the Forwarding Service mints the USDC (minus fees) on Base Sepolia to the owner",
    !!msg?.forwardTxHash && minted > BigInt(0) && minted <= amount,
    msg ? `status ${msg.status}, forward ${msg.forwardState ?? "?"} ${msg.forwardTxHash ?? ""}, +${fmtU(minted)} USDC on Base Sepolia` : "no attestation yet",
  );
  return { burnTx, amount: fmtU(amount), destination: "Base Sepolia", forwardTxHash: msg?.forwardTxHash ?? null, attestation: msg?.status ?? null, mintedUsdc: fmtU(minted) };
}
