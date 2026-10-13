import { createPublicClient, getAddress, http, isAddress, parseAbi, type Address, type Hex } from 'viem';
/** ABI matches contracts/src/ccip/KomaCanonReceipt.sol; no transaction functions. */
export const canonReceiptAbi = parseAbi([
 'function getRouter() view returns (address)',
 'function received(bytes32) view returns (bool)',
 'function receipts(bytes32) view returns (uint256 issueId, bytes32 contentHash, bytes32 paymentTx, bytes32 messageId)',
 'event CanonReceived(bytes32 indexed key, bytes32 indexed messageId, uint64 indexed sourceChain, address sender, uint256 seriesId, uint256 episode, uint256 issueId, bytes32 contentHash, bytes32 paymentTx)',
]);
export type ReceiptConfig = { rpc: string; chainId: number; receiver: Address };
export function receiptConfig(env: Record<string,string|undefined> = process.env): ReceiptConfig | null {
 if (env.KOMA_CCIP_RECEIPTS_ENABLED !== '1') return null;
 const rpc=env.KOMA_CCIP_RECEIPT_RPC_URL;
 const receiver=env.KOMA_CCIP_RECEIPT_ADDRESS;
 const chainId=Number(env.KOMA_CCIP_RECEIPT_CHAIN_ID);
 if (!rpc || !/^https?:\/\//.test(rpc) || !receiver || !isAddress(receiver) || /^0x0{40}$/i.test(receiver) || !Number.isSafeInteger(chainId) || chainId<=0) throw new Error('Invalid CCIP receipt configuration.');
 return {rpc,receiver:getAddress(receiver),chainId};
}
export type CanonReceiptRow = { key: Hex; messageId: Hex; sourceChain: string; sender: Address; seriesId: string; episode: string; issueId: string; contentHash: Hex; paymentTx: Hex; transactionHash: Hex; block: string };
export type ReceiptView = { state: 'unconfigured'|'unavailable'|'ready'; rows: CanonReceiptRow[]; chainId?: number; receiver?: Address; router?: Address; fromBlock?: string; toBlock?: string };
export async function readCanonReceipts(config: ReceiptConfig | null, client = config ? createPublicClient({transport:http(config.rpc,{timeout:5000,retryCount:0})}) : null): Promise<ReceiptView> {
 if (!config) return {state:'unconfigured',rows:[]};
 const base={chainId:config.chainId,receiver:config.receiver};
 try {
  if (!client || await client.getChainId() !== config.chainId) throw new Error('Wrong chain');
  const code=await client.getCode({address:config.receiver});
  if (!code || code==='0x') throw new Error('No receiver contract');
  const router=await client.readContract({address:config.receiver,abi:canonReceiptAbi,functionName:'getRouter'});
  if (/^0x0{40}$/i.test(router)) throw new Error('No router');
  const routerCode = await client.getCode({address:router});
  if (!routerCode || routerCode==='0x') throw new Error('No router contract');
  const toBlock=await client.getBlockNumber();
  const fromBlock=toBlock>BigInt(999)?toBlock-BigInt(999):BigInt(0);
  const logs=await client.getContractEvents({address:config.receiver,abi:canonReceiptAbi,eventName:'CanonReceived',fromBlock,toBlock,strict:true});
  const rows: CanonReceiptRow[]=[];
  for (const log of logs.slice(-25).reverse()) {
   if (log.removed) continue;
   const a=log.args;
   const [accepted,stored]=await Promise.all([
    client.readContract({address:config.receiver,abi:canonReceiptAbi,functionName:'received',args:[a.messageId]}),
    client.readContract({address:config.receiver,abi:canonReceiptAbi,functionName:'receipts',args:[a.key]}),
   ]);
   if (!accepted || stored[0]!==a.issueId || stored[1]!==a.contentHash || stored[2]!==a.paymentTx) throw new Error('Receipt storage mismatch');
   rows.push({key:a.key,messageId:a.messageId,sourceChain:a.sourceChain.toString(),sender:a.sender,seriesId:a.seriesId.toString(),episode:a.episode.toString(),issueId:a.issueId.toString(),contentHash:a.contentHash,paymentTx:a.paymentTx,transactionHash:log.transactionHash,block:log.blockNumber.toString()});
  }
  return {state:'ready',...base,router,fromBlock:fromBlock.toString(),toBlock:toBlock.toString(),rows};
 }catch { return {state:'unavailable',...base,rows:[]}; }
}
export async function canonReceiptView(): Promise<ReceiptView> {
 try { return await readCanonReceipts(receiptConfig()); }catch { return {state:'unavailable',rows:[]}; }
}
