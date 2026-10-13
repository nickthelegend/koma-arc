import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readPendingTrade,savePendingTrade,clearPendingTrade,pendingMatches} from '../src/lib/launchpad/pending-trade.ts';
// Unsigned storage metadata only: no chain/provider successful result fixture.
const intent={version:1,id:'storage-only',chainId:5042002,wallet:'0x'+'11'.repeat(20),tradeContract:'0x'+'22'.repeat(20),coin:'0x'+'33'.repeat(20),side:'buy',amount:'1',minimum:'0',seriesId:1,pool:false,direct:true,stage:'intent',stepContract:'0x'+'22'.repeat(20),startedAt:1};
test('durable unresolved identity survives a new storage reader; foreign context cannot resolve it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'koma-negative-journal-'));const file=path.join(dir,'pending');const disk={getItem(){return fs.existsSync(file)?fs.readFileSync(file,'utf8'):null},setItem(_key,value){fs.writeFileSync(file,value)},removeItem(){fs.rmSync(file,{force:true})}};
 try{savePendingTrade(disk,intent);assert.equal(readPendingTrade({...disk}).id,intent.id);assert.equal(pendingMatches(intent,intent.coin,5042002,intent.tradeContract),false);assert.equal(pendingMatches(intent,intent.wallet,143,intent.tradeContract),false);assert.equal(pendingMatches(intent,intent.wallet,5042002,intent.coin),false);assert.throws(()=>savePendingTrade(disk,{...intent,id:'foreign'}),/unresolved/);assert.throws(()=>clearPendingTrade(disk,'foreign'),/identity changed/);assert.throws(()=>savePendingTrade({...disk,setItem(){throw new Error('quota')}},intent),/quota/);assert.equal(readPendingTrade(disk).id,intent.id);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid input cannot overwrite the lock and signatures/keys cannot serialize',()=>{
 let raw=null;const storage={getItem(){return raw},setItem(_key,value){raw=value},removeItem(){raw=null}};
 savePendingTrade(storage,{...intent,signature:'not-a-signature',privateKey:'not-a-key'});assert.equal(raw.includes('signature'),false);assert.equal(raw.includes('privateKey'),false);assert.throws(()=>savePendingTrade(storage,{...intent,amount:'-1'}),/invalid/);assert.equal(readPendingTrade(storage).amount,'1');raw='null';assert.throws(()=>readPendingTrade(storage),/invalid/);raw='malformed';assert.throws(()=>readPendingTrade(storage),/unreadable/);
});

test('frozen inputs, receipt identity and series scope cannot silently change',()=>{
 let raw=null;const storage={getItem(){return raw},setItem(_key,value){raw=value},removeItem(){raw=null}};
 savePendingTrade(storage,intent);
 for(const change of [{wallet:intent.coin},{tradeContract:intent.coin},{coin:intent.wallet},{amount:'2'},{minimum:'2'},{seriesId:2},{side:'sell'},{pool:true},{direct:false},{startedAt:2}])assert.throws(()=>savePendingTrade(storage,{...intent,...change}),/frozen/);
 assert.equal(pendingMatches(intent,intent.wallet,5042002,intent.tradeContract,2,intent.coin,false),false);
 assert.equal(pendingMatches(intent,intent.wallet,5042002,intent.tradeContract,1,intent.wallet,false),false);
 assert.equal(pendingMatches(intent,intent.wallet,5042002,intent.tradeContract,1,intent.coin,true),false);
 const known={...intent,stage:'trade',hash:'0x'+'aa'.repeat(32)};savePendingTrade(storage,known);
 assert.throws(()=>savePendingTrade(storage,{...known,hash:'0x'+'bb'.repeat(32)}),/hash cannot be replaced/);
 assert.throws(()=>savePendingTrade(storage,{...known,stage:'approval'}),/backwards/);
 assert.equal(readPendingTrade(storage).hash,known.hash);
 assert.throws(()=>readPendingTrade({...storage,getItem(){throw Error('unavailable')}}),/unavailable/);
});
import {clearUnsignedTrade} from '../src/lib/launchpad/pending-trade.ts';
import {SubmissionBoundary} from '../src/lib/submission-boundary.ts';
test('only pre-submission unsigned refusal releases exact owned identity',async()=>{let raw=null;const s={getItem(){return raw},setItem(_k,v){raw=v},removeItem(){raw=null}};savePendingTrade(s,intent);const before=new SubmissionBoundary();try{await Promise.reject(Error('local typed data rejected'));}catch{before.releaseUnsigned(()=>clearUnsignedTrade(s,intent));}assert.equal(raw,null);savePendingTrade(s,intent);const after=new SubmissionBoundary();try{after.enter();await Promise.reject(Error('wallet submission response lost'));}catch{after.releaseUnsigned(()=>clearUnsignedTrade(s,intent));}assert.ok(readPendingTrade(s));assert.throws(()=>clearUnsignedTrade(s,{...intent,wallet:intent.coin}),/remains locked/);const sent={...intent,stage:'trade'};savePendingTrade(s,sent);assert.throws(()=>clearUnsignedTrade(s,sent),/remains locked/);assert.ok(raw);});
