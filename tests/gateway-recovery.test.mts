import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatewayAttestation } from '../src/lib/server/gateway-journal.ts';
import {gatewayModuleUrl} from './gateway-test-loader.mjs';
const {parseGatewayBackup,gatewayBackupKey}=await import(gatewayModuleUrl('gateway-recovery'));
const previous = process.env.KOMA_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), 'koma-gateway-recovery-'));
process.env.KOMA_DATA_DIR = dir;
after(() => { rmSync(dir, {recursive:true,force:true}); if (previous === undefined) delete process.env.KOMA_DATA_DIR; else process.env.KOMA_DATA_DIR = previous; });
const result = { attestation:'0x1234', signature:'0x5678', minter:'0x1111111111111111111111111111111111111111', transferId:'11111111-1111-1111-1111-111111111111' } as const;
test('lost browser response recovers durable original response without another Circle submission', async () => {
 const key=`0x${'a'.repeat(64)}`; let calls=0;
 await gatewayAttestation(key,async()=>{calls++;return result;});
 assert.deepEqual(await gatewayAttestation(key,async()=>{throw Error('must not submit');},true),result);
 assert.equal(calls,1);
});
test('uncertain upstream outcome stays recorded across a retry and never resubmits', async () => {
 const key=`0x${'b'.repeat(64)}`; let calls=0;
 await assert.rejects(gatewayAttestation(key,async()=>{calls++;throw Error('response lost');}),/response lost/);
 await assert.rejects(gatewayAttestation(key,async()=>{calls++;return result;}),/outcome is not known/);
 assert.equal(calls,1);
});
test('overlapping browser requests share one live Circle submission', async () => {
 const key=`0x${'c'.repeat(64)}`; let calls=0; let release;
 const wait = new Promise<void>(resolve=>{release=resolve;});
 const first=gatewayAttestation(key,async()=>{calls++;await wait;return result;});
 const second=gatewayAttestation(key,async()=>{calls++;return result;});
 release(); assert.deepEqual(await Promise.all([first,second]),[result,result]); assert.equal(calls,1);
});
test('legacy signature-bearing browser backup is refused rather than silently permitting a new authorization', () => {
 const owner='0x1111111111111111111111111111111111111111';
 const saved={version:1,owner,chainId:5042002,burnIntent:{spec:{salt:'original'}},ownerSignature:'0x1234',result,mintHash:`0x${'f'.repeat(64)}`};
 assert.throws(()=>parseGatewayBackup(JSON.stringify(saved),5042002,owner),/legacy/);
 assert.equal(gatewayBackupKey(5042002,owner),`koma-gateway:5042002:${owner}`);
});
