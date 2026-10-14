import {isAddress,isHex,type Hex} from 'viem';
export const PENDING_TRADE_KEY='koma:arc:pending-trade:v1';
export type TradeChainId = 5042 | 5042002;
export const isTradeChain = (chainId: number): chainId is TradeChainId => chainId === 5042 || chainId === 5042002;
export function assertTradeNetwork(recorded: number, configured: number, rpc: number): void {
 if (!isTradeChain(recorded) || recorded !== configured || recorded !== rpc) throw new Error("Recovery RPC does not match the original Arc network");
}
export interface PendingTrade {version:1;id:string;chainId:TradeChainId;wallet:string;tradeContract:string;coin:string;side:'buy'|'sell';amount:string;minimum:string;seriesId:number;pool:boolean;direct:boolean;stage:'intent'|'approval'|'trade';stepContract:string;hash?:Hex;approvalHash?:Hex;startedAt:number;}
export type JournalStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function readPendingTrade(storage:JournalStorage):PendingTrade|null {
 const raw=storage.getItem(PENDING_TRADE_KEY);if(raw===null)return null;
 let p:PendingTrade;try{p=JSON.parse(raw) as PendingTrade;}catch{throw new Error("The pending trade journal is unreadable; new trades are blocked.");}
 if(!p||typeof p!=="object")throw new Error("The pending trade journal is invalid; new trades are blocked.");
 if(p.version!==1||!isTradeChain(p.chainId)||(typeof p.id!=='string'||!p.id)||![p.wallet,p.tradeContract,p.coin,p.stepContract].every(address=>typeof address==='string'&&isAddress(address))||!['buy','sell'].includes(p.side)||!['intent','approval','trade'].includes(p.stage)||(typeof p.amount!=='string'||!/^[1-9]\d*$/.test(p.amount))||(typeof p.minimum!=='string'||!/^\d+$/.test(p.minimum))||(!Number.isSafeInteger(p.seriesId)||p.seriesId<0)||typeof p.pool!=='boolean'||typeof p.direct!=='boolean'||!Number.isFinite(p.startedAt)||(p.hash!==undefined&&(!isHex(p.hash)||p.hash.length!==66)))throw new Error('The pending trade journal is invalid; no new trade will be submitted.');
 if(p.approvalHash!==undefined&&(!isHex(p.approvalHash)||p.approvalHash.length!==66))throw new Error("Invalid approval receipt identity");
 return {version:1,id:p.id,chainId:p.chainId,wallet:p.wallet,tradeContract:p.tradeContract,coin:p.coin,side:p.side,amount:p.amount,minimum:p.minimum,seriesId:p.seriesId,pool:p.pool,direct:p.direct,stage:p.stage,stepContract:p.stepContract,hash:p.hash,approvalHash:p.approvalHash,startedAt:p.startedAt};
}
export function savePendingTrade(storage:JournalStorage,pending:PendingTrade):void {
 const existing=readPendingTrade(storage);if(existing&&existing.id!==pending.id)throw new Error('Another transaction is unresolved. Check its receipt first.');
 const validated=readPendingTrade({getItem:()=>JSON.stringify(pending),setItem(){},removeItem(){}})!;
 if(existing){
  for(const key of ['chainId','wallet','tradeContract','coin','side','amount','minimum','seriesId','pool','direct','startedAt'] as const){
   if(existing[key]!==pending[key])throw new Error('The frozen pending trade cannot be changed. Check its original receipt.');
  }
  if(existing.stage==='trade'&&pending.stage!=='trade')throw new Error('The broadcast stage cannot move backwards.');
  if(existing.hash&&existing.stage===pending.stage&&existing.hash.toLowerCase()!==pending.hash?.toLowerCase())throw new Error('The original transaction hash cannot be replaced.');
  if(existing.approvalHash&&existing.approvalHash.toLowerCase()!==pending.approvalHash?.toLowerCase())throw new Error('The original approval hash cannot be replaced.');
 }


 const raw=JSON.stringify(validated);storage.setItem(PENDING_TRADE_KEY,raw);if(storage.getItem(PENDING_TRADE_KEY)!==raw)throw new Error('Could not durably record the transaction; submission is blocked.');
}
export function clearPendingTrade(storage:JournalStorage,id:string):void {const current=readPendingTrade(storage);if(current&&current.id!==id)throw new Error('The pending transaction identity changed.');storage.removeItem(PENDING_TRADE_KEY);if(storage.getItem(PENDING_TRADE_KEY)!==null)throw new Error('Could not clear the resolved transaction journal.');}
export function pendingMatches(p:PendingTrade,wallet:string|undefined,chainId:number,contract:string,seriesId?:number,coin?:string,pool?:boolean):boolean{return (seriesId===undefined||p.seriesId===seriesId)&&(coin===undefined||p.coin.toLowerCase()===coin.toLowerCase())&&(pool===undefined||p.pool===pool)&&Boolean(wallet)&&p.chainId===chainId&&p.wallet.toLowerCase()===wallet?.toLowerCase()&&p.tradeContract.toLowerCase()===contract.toLowerCase();}

/** Only the exact unsigned record owned by this invocation may be released. */
export function clearUnsignedTrade(storage:JournalStorage,p:PendingTrade):void {const current=readPendingTrade(storage);if(p.stage!=="intent"||p.hash||p.approvalHash||!current||JSON.stringify(current)!==JSON.stringify(p))throw new Error("The original transaction may have been submitted; it remains locked.");clearPendingTrade(storage,p.id);}
