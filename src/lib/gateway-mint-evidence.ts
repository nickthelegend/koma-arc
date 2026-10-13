import { decodeEventLog, getAddress, type Hex, type TransactionReceipt } from 'viem';
import { burnIntentRecipient, gatewayTransferSpecHash, type BurnIntent, type GatewayNetwork } from './gateway';

// Circle's actual GatewayMinter event: src/modules/minter/Mints.sol.
const ABI = [{ type: 'event', name: 'AttestationUsed', inputs: [
  { name: 'token', type: 'address', indexed: true },
  { name: 'recipient', type: 'address', indexed: true },
  { name: 'transferSpecHash', type: 'bytes32', indexed: true },
  { name: 'sourceDomain', type: 'uint32', indexed: false },
  { name: 'sourceDepositor', type: 'bytes32', indexed: false },
  { name: 'sourceSigner', type: 'bytes32', indexed: false },
  { name: 'value', type: 'uint256', indexed: false },
] }] as const;

/** A successful unrelated transaction cannot clear the saved authorization. */
export function matchesGatewayMint(receipt: TransactionReceipt, hash: Hex, g: GatewayNetwork, intent: BurnIntent): boolean {
  if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return false;
  return receipt.logs.some(log => {
    if (getAddress(log.address) !== getAddress(g.minter) || log.removed || log.transactionHash?.toLowerCase() !== hash.toLowerCase() || log.blockHash !== receipt.blockHash) return false;
    try {
      const { args } = decodeEventLog({ abi: ABI, eventName: 'AttestationUsed', topics: log.topics, data: log.data, strict: true });
      return getAddress(args.token) === getAddress(g.arcUsdc)
        && getAddress(args.recipient) === burnIntentRecipient(intent)
        && args.transferSpecHash.toLowerCase() === gatewayTransferSpecHash(intent).toLowerCase()
        && args.sourceDomain === intent.spec.sourceDomain
        && args.sourceDepositor.toLowerCase() === intent.spec.sourceDepositor.toLowerCase()
        && args.sourceSigner.toLowerCase() === intent.spec.sourceSigner.toLowerCase()
        && args.value === intent.spec.value;
    } catch { return false; }
  });
}
