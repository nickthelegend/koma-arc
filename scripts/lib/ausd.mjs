// Test AUSD on the local Monad testnet fork: move real AUSD out of Agora's faucet contract (it holds ~1B)
// so a wallet ends up with exactly `amount`. Surplus goes back to the faucet. Local anvil fork only.
import { encodeFunctionData, parseAbi } from "viem";

export const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const AGORA_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
/** AUSD's EIP-712 domain (eip712Domain() on-chain): "Agora Dollar", version "1". */
export const AUSD_DOMAIN = { name: "Agora Dollar", version: "1" };

const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

export async function setAusd(chain, who, amount) {
  const have = await chain.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [who] });
  if (have === amount) return;
  const [from, to, value] = have < amount ? [AGORA_FAUCET, who, amount - have] : [who, AGORA_FAUCET, have - amount];
  await chain.request({ method: "anvil_setBalance", params: [from, "0x56BC75E2D63100000"] });
  await chain.request({ method: "anvil_impersonateAccount", params: [from] });
  try {
    const hash = await chain.request({
      method: "eth_sendTransaction",
      params: [{ from, to: AUSD, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to, value] }) }],
    });
    await chain.waitForTransactionReceipt({ hash });
  } finally {
    await chain.request({ method: "anvil_stopImpersonatingAccount", params: [from] });
  }
}
