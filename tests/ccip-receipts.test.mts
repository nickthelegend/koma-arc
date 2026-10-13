import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonReceiptAbi, receiptConfig, readCanonReceipts } from '../src/lib/server/ccip-receipts.ts';
const address='0x1111111111111111111111111111111111111111';
const config={rpc:'http://127.0.0.1:9999',receiver:address,chainId:5042002} as const;
const hash=(char:string)=>`0x${char.repeat(64)}`;
const args={key:hash('a'),messageId:hash('b'),sourceChain:7n,sender:address,seriesId:1n,episode:2n,issueId:3n,contentHash:hash('c'),paymentTx:hash('d')};
function reader(overrides={}) {
 return {getChainId:async()=>5042002,getCode:async()=> '0x1234',getBlockNumber:async()=>2000n,getContractEvents:async(options)=>{assert.equal(options.fromBlock,1001n);assert.equal(options.toBlock,2000n);return [{args,removed:false,transactionHash:hash('e'),blockNumber:1900n}];},readContract:async({functionName})=>functionName==='getRouter'?address:functionName==='received'?true:[3n,args.contentHash,args.paymentTx,args.messageId],...overrides} as unknown as Parameters<typeof readCanonReceipts>[1];
}
test('read-only ABI exposes actual receiver event and storage, no write functions',()=>{
 assert.deepEqual(canonReceiptAbi.filter(a=>a.type==='function').map(a=>a.name),['getRouter','received','receipts']);
 assert.equal(receiptConfig({}),null);
 assert.throws(()=>receiptConfig({KOMA_CCIP_RECEIPTS_ENABLED:'1'}));
 assert.deepEqual(receiptConfig({KOMA_CCIP_RECEIPTS_ENABLED:'1',KOMA_CCIP_RECEIPT_RPC_URL:config.rpc,KOMA_CCIP_RECEIPT_ADDRESS:address,KOMA_CCIP_RECEIPT_CHAIN_ID:'5042002'}),config);
});
test('disconnected unconfigured view performs no RPC',async()=>{
 assert.deepEqual(await readCanonReceipts(null,reader({getChainId:()=>{throw Error('must not read');}})),{state:'unconfigured',rows:[]});
});
test('configured receiver scans bounded real events and verifies stored acceptance',async()=>{
 const view=await readCanonReceipts(config,reader());assert.equal(view.state,'ready');assert.equal(view.rows.length,1);assert.equal(view.rows[0].messageId,args.messageId);assert.equal(view.rows[0].sourceChain,'7');assert.equal(view.rows[0].issueId,'3');
});
test('wrong chain, missing code, unknown router, RPC outage and storage mismatch fail honestly',async()=>{
 for(const override of [{getChainId:async()=>1},{getCode:async()=> '0x'},{getBlockNumber:async()=>{throw Error('RPC secret URL');}},{readContract:async()=>false}]) {
  const view=await readCanonReceipts(config,reader(override));assert.equal(view.state,'unavailable');assert.deepEqual(view.rows,[]);assert.equal(JSON.stringify(view).includes('secret'),false);
 }
});
test('empty event range is an observed empty range, never fabricated receipts',async()=>{
 const view=await readCanonReceipts(config,reader({getContractEvents:async()=>[]}));assert.equal(view.state,'ready');assert.deepEqual(view.rows,[]);
});
