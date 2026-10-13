import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {buildBurnIntent,burnIntentToJson,gatewayFor} from '../src/lib/gateway.ts';
import type {GatewayBackup} from '../src/lib/gateway-recovery.ts';
import {gatewayModuleUrl} from './gateway-test-loader.mjs';
const {saveGatewayBackup,parseGatewayBackup,clearGatewayBackup}=await import(gatewayModuleUrl('gateway-recovery'));
const owner='0x1111111111111111111111111111111111111111';const h=`0x${'aa'.repeat(32)}` as const;const g=gatewayFor('testnet');
const p:GatewayBackup={version:2,owner,chainId:5042002,burnIntent:burnIntentToJson(buildBurnIntent(g,{depositor:owner,recipient:owner,sourceDomain:g.sources[0].domain,value:BigInt(1000000),salt:h})),stage:'unsigned'};
test('real disk restart retains submitting uncertainty, strips secrets and prevents original replacement',()=>{
 const dir=mkdtempSync(join(tmpdir(),'koma-gateway-public-'));const file=join(dir,'journal');const s={getItem(){return existsSync(file)?readFileSync(file,'utf8'):null;},setItem(_k:string,v:string){writeFileSync(file,v);},removeItem(){rmSync(file,{force:true});}};
 try{saveGatewayBackup(s,{...p,ownerSignature:'secret',result:{signature:'secret',attestation:'secret'},privateKey:'secret'} as GatewayBackup);assert.ok(!readFileSync(file,'utf8').includes('secret'));
 const submitting=saveGatewayBackup(s,{...p,stage:'attesting',ownerSignatureHash:h});assert.equal(parseGatewayBackup(readFileSync(file,'utf8'),p.chainId,owner).stage,'attesting');assert.throws(()=>saveGatewayBackup(s,p),/cannot/);
 const attested=saveGatewayBackup(s,{...submitting,stage:'attested',attestationHash:h,attestationSignatureHash:h,transferId:'11111111-1111-1111-1111-111111111111'});
 const minting=saveGatewayBackup(s,{...attested,stage:'mint-submitting'});assert.equal(parseGatewayBackup(readFileSync(file,'utf8'),p.chainId,owner).mintHash,undefined);
 assert.throws(()=>saveGatewayBackup(s,attested),/reversed/);assert.throws(()=>saveGatewayBackup(s,{...minting,transferId:'22222222-2222-2222-2222-222222222222'}),/cannot/);
 const sent=saveGatewayBackup(s,{...minting,stage:'mint-submitted',mintHash:h});assert.throws(()=>saveGatewayBackup(s,{...sent,mintHash:`0x${'bb'.repeat(32)}`}),/cannot/);assert.throws(()=>clearGatewayBackup(s,minting),/changed/);assert.ok(existsSync(file));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed writes, clearing failures, foreign/legacy/corrupt data remain blocked',()=>{
 let raw:string|null=null;const s={getItem(){return raw;},setItem(_k:string,v:string){raw=v;},removeItem(){raw=null;}};
 assert.throws(()=>saveGatewayBackup({...s,setItem(){}},p),/not saved/);saveGatewayBackup(s,p);
 assert.throws(()=>clearGatewayBackup({...s,removeItem(){}},p),/could not/);assert.throws(()=>parseGatewayBackup(raw,1,owner));assert.throws(()=>parseGatewayBackup(raw,p.chainId,'0x2222222222222222222222222222222222222222'));
 assert.throws(()=>parseGatewayBackup(JSON.stringify({...p,version:1,ownerSignature:'0x1234'}),p.chainId,owner),/legacy/);assert.throws(()=>parseGatewayBackup('{',p.chainId,owner));clearGatewayBackup(s,p);assert.equal(raw,null);
});

test('read recovery proof is purpose/domain-bound and expires without financial authorization reuse',async()=>{
 const {gatewayRecoveryProof,recoveryIssuedAt}=await import(gatewayModuleUrl('gateway-recovery-proof'));
 const {hashTypedData}=await import('viem');const {burnIntentFromJson,burnIntentTypedData}=await import('../src/lib/gateway.ts');
 const intent=burnIntentFromJson(g,p.burnIntent);const proof=gatewayRecoveryProof(g,intent,BigInt(1000));
 assert.equal(proof.primaryType,'GatewayRecoveryRead');assert.equal(proof.domain.chainId,5042002);assert.equal(proof.domain.verifyingContract,g.minter);
 assert.notEqual(hashTypedData(proof),hashTypedData(burnIntentTypedData(intent)));
 assert.notEqual(hashTypedData(proof),hashTypedData(gatewayRecoveryProof(g,intent,BigInt(1001))));
 assert.equal(recoveryIssuedAt('1000',1120),BigInt(1000));assert.throws(()=>recoveryIssuedAt('1000',1121),/expired/);assert.throws(()=>recoveryIssuedAt('1016',1000),/expired/);assert.throws(()=>recoveryIssuedAt(undefined,1000),/missing/);
});
