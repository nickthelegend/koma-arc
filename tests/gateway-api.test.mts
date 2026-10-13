import {gatewayModuleUrl} from './gateway-test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
const originalDataDir = process.env.KOMA_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'koma-gateway-api-'));
process.env.KOMA_DATA_DIR = dataDir;
after(() => { rmSync(dataDir, { recursive:true, force:true }); if (originalDataDir === undefined) delete process.env.KOMA_DATA_DIR; else process.env.KOMA_DATA_DIR = originalDataDir; });
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/app/api/gateway/route.ts', import.meta.url), 'utf8')
  .replace("'next/server'", JSON.stringify(pathToFileURL(require.resolve('next/server.js')).href))
  .replace("'viem'", JSON.stringify(new URL('../node_modules/viem/_esm/index.js', import.meta.url).href))
  .replace("'@/lib/gateway-recovery-proof'", JSON.stringify(gatewayModuleUrl('gateway-recovery-proof')))
  .replace("'@/lib/network'", JSON.stringify(new URL('../src/lib/network.ts', import.meta.url).href))
  .replace("'@/lib/server/gateway-journal'", JSON.stringify(new URL('../src/lib/server/gateway-journal.ts', import.meta.url).href))
  .replace("'@/lib/gateway'", JSON.stringify(new URL('../src/lib/gateway.ts', import.meta.url).href));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const post = (body: unknown) => POST(new Request('http://localhost/api/gateway', { method: 'POST', body: JSON.stringify(body) }));
test('disabled Gateway fails closed before network or signed actions', async () => {
  const flag = process.env.NEXT_PUBLIC_FEATURE_GATEWAY; delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY;
  try {
    assert.equal((await GET(new Request('http://localhost/api/gateway'))).status, 503);
    assert.equal((await post({ action: 'attest' })).status, 503);
  } finally { if (flag === undefined) delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY; else process.env.NEXT_PUBLIC_FEATURE_GATEWAY = flag; }
});
test('Gateway API refuses malformed actions and reports upstream outages without execution', async () => {
  const flag = process.env.NEXT_PUBLIC_FEATURE_GATEWAY;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_FEATURE_GATEWAY = '1';
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('offline'); };
  try {
    for (const body of [null, { action: 'unknown' }, { action: 'quote', address: 'bad', amount: '1' }, { action: 'attest', burnIntent: null, signature: '0x' }]) assert.equal((await post(body)).status, 400);
    assert.equal(calls, 0);
    assert.equal((await GET(new Request('http://localhost/api/gateway?address=0x1111111111111111111111111111111111111111'))).status, 502);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; if (flag === undefined) delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY; else process.env.NEXT_PUBLIC_FEATURE_GATEWAY = flag; }
});
test('quotes use Circle fee/expiry while preserving the requested destination', async () => {
  const flag = process.env.NEXT_PUBLIC_FEATURE_GATEWAY;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_FEATURE_GATEWAY = '1';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body[0].spec.destinationDomain, 26);
    return Response.json({ body: [{ burnIntent: { maxFee: '125000', maxBlockHeight: '1000', spec: { destinationDomain: 0 } } }] });
  };
  try {
    const response = await post({ action: 'quote', address: '0x1111111111111111111111111111111111111111', amount: '1.25', sourceDomain: 0 });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.burnIntent.maxFee, '125000');
    assert.equal(result.burnIntent.maxBlockHeight, '1000');
    assert.equal(result.burnIntent.spec.value, '1250000');
    assert.equal(result.burnIntent.spec.destinationDomain, 26);
  } finally { globalThis.fetch = originalFetch; if (flag === undefined) delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY; else process.env.NEXT_PUBLIC_FEATURE_GATEWAY = flag; }
});
test('only the depositing wallet can authorize its same-wallet transfer', async () => {
  const { privateKeyToAccount } = await import('viem/accounts');
  const { gatewayFor, buildBurnIntent, burnIntentToJson, burnIntentTypedData } = await import('../src/lib/gateway.ts');
  const owner = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const stranger = privateKeyToAccount(`0x${'2'.repeat(64)}`);
  const intent = buildBurnIntent(gatewayFor('testnet'), { depositor: owner.address, recipient: owner.address, sourceDomain: 0, value: 1000000n, salt: `0x${'a'.repeat(64)}` });
  const flag = process.env.NEXT_PUBLIC_FEATURE_GATEWAY;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_FEATURE_GATEWAY = '1';
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++; assert.match(String(url), /\/v1\/transfer$/);
    assert.equal(JSON.parse(String(init?.body))[0].burnIntent.spec.value, '1000000');
    return Response.json({ attestation: '0x1234', signature: '0xabcd' });
  };
  try {
    const burnIntent = burnIntentToJson(intent);
    const wrong = await stranger.signTypedData(burnIntentTypedData(intent));
    assert.equal((await post({ action: 'attest', burnIntent, signature: wrong })).status, 400);
    assert.equal(calls, 0);
    const signature = await owner.signTypedData(burnIntentTypedData(intent));
    const response = await post({ action: 'attest', burnIntent, signature });
    assert.equal(response.status, 200); assert.equal(calls, 1);
    assert.equal((await response.json()).attestation, '0x1234');
  } finally { globalThis.fetch = originalFetch; if (flag === undefined) delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY; else process.env.NEXT_PUBLIC_FEATURE_GATEWAY = flag; }
});
test('Circle transfer-ID recovery binds the original TransferSpec and never POSTs', async () => {
 const { privateKeyToAccount } = await import('viem/accounts');
 const { gatewayFor, buildBurnIntent, burnIntentToJson, burnIntentTypedData, gatewayTransferSpecHash } = await import('../src/lib/gateway.ts');
 const owner=privateKeyToAccount(`0x${'3'.repeat(64)}`);
 const intent=buildBurnIntent(gatewayFor('testnet'),{depositor:owner.address,recipient:owner.address,sourceDomain:0,value:1000000n,salt:`0x${'b'.repeat(64)}`});
 const signature=await owner.signTypedData(burnIntentTypedData(intent));
 const previousFlag=process.env.NEXT_PUBLIC_FEATURE_GATEWAY; const originalFetch=globalThis.fetch;
 process.env.NEXT_PUBLIC_FEATURE_GATEWAY='1'; let match=false;
 globalThis.fetch=async (url,init)=>{
  assert.equal(init?.method,'GET'); assert.match(String(url),/\/v1\/transfer\/11111111-/);
  return Response.json({destinationDomain:26,status:'pending',burnIntents:[{transferSpecHash:match?gatewayTransferSpecHash(intent):`0x${'f'.repeat(64)}`}],attestation:{payload:'0x1234',signature:'0xabcd',expirationBlock:'99999'}});
 };
 try {
  const body={action:'recover',burnIntent:burnIntentToJson(intent),signature,transferId:'11111111-1111-1111-1111-111111111111'};
  assert.equal((await post(body)).status,400);
  match=true; const response=await post(body); assert.equal(response.status,200); assert.equal((await response.json()).attestation,'0x1234');
 }finally{globalThis.fetch=originalFetch;if(previousFlag===undefined)delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY;else process.env.NEXT_PUBLIC_FEATURE_GATEWAY=previousFlag;}
});

test('read recovery refuses missing or expired owner authorization before original-record lookup',async()=>{
 const {buildBurnIntent,burnIntentToJson,gatewayFor}=await import('../src/lib/gateway.ts');const g=gatewayFor('testnet');const owner='0x1111111111111111111111111111111111111111';
 const burnIntent=burnIntentToJson(buildBurnIntent(g,{depositor:owner,recipient:owner,sourceDomain:g.sources[0].domain,value:BigInt(1000000),salt:`0x${'a'.repeat(64)}`}));
 const flag=process.env.NEXT_PUBLIC_FEATURE_GATEWAY;process.env.NEXT_PUBLIC_FEATURE_GATEWAY='1';
 try{
  const absent=await post({action:'recover',burnIntent});assert.equal(absent.status,400);assert.match((await absent.json()).error,/read-only recovery proof/);
  const expired=await post({action:'recover',burnIntent,recoverySignature:'0x',issuedAt:'1'});assert.equal(expired.status,400);assert.match((await expired.json()).error,/expired/);
  const invalid=await post({action:'recover',burnIntent,recoverySignature:'0x',issuedAt:Math.floor(Date.now()/1000).toString()});assert.equal(invalid.status,400);
 }finally{if(flag===undefined)delete process.env.NEXT_PUBLIC_FEATURE_GATEWAY;else process.env.NEXT_PUBLIC_FEATURE_GATEWAY=flag;}
});
