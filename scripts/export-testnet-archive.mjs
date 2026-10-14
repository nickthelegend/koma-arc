/** Export public testnet comics only, after checking receipts and NFT ownership on chain.
 * KOMA_DATA_DIR=.data.t8610 node scripts/export-testnet-archive.mjs
 * No jobs, private drafts, signatures, credentials or fork artifacts are exported. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPublicClient,http,parseAbi} from 'viem';
const client=createPublicClient({transport:http('https://rpc.testnet.arc.io')});
assert.equal(await client.getChainId(),5042002);
const deployment=JSON.parse(readFileSync('deployments/arc-testnet.json','utf8'));
const dir=path.resolve(process.env.KOMA_DATA_DIR||'.data.t8610');
const db=new DatabaseSync(path.join(dir,'koma.db'),{readOnly:true});
const comics=db.prepare('SELECT data FROM issues ORDER BY created_at DESC').all().map(r=>JSON.parse(r.data));
const art=new Set();
function collect(x){if(typeof x==='string' && /^\/api\/art\/[a-z0-9-]+\/[a-z0-9-]+\.jpg$/.test(x))art.add(x);else if(x&&typeof x==='object')Object.values(x).forEach(collect);}
for(const c of comics){
 const mint=await client.getTransactionReceipt({hash:c.chain.mintTx});
 const payment=await client.getTransactionReceipt({hash:c.chain.paymentTx});
 assert.equal(mint.status,'success');assert.equal(payment.status,'success');
 assert.equal(mint.to.toLowerCase(),deployment.komaIssues.toLowerCase());
 await client.readContract({address:deployment.komaIssues,abi:parseAbi(['function ownerOf(uint256) view returns (address)']),functionName:'ownerOf',args:[BigInt(c.chain.tokenId)]});
 collect(c);
}
const seriesMeta=db.prepare('SELECT * FROM lp_series_meta').all();
for(const m of seriesMeta){
 await client.readContract({address:deployment.characterNft,abi:parseAbi(['function ownerOf(uint256) view returns (address)']),functionName:'ownerOf',args:[BigInt(m.id)]});collect(m);
}
for(const url of art){const relative=url.slice('/api/art/'.length);const target=path.join('public','archive','testnet','art',relative);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(dir,'art',relative),target);}
writeFileSync('deployments/hosted-comics-testnet.json',JSON.stringify({chainId:5042002,verifiedAt:new Date().toISOString(),comics,seriesMeta},null,2)+'\n');
console.log(`Archived ${comics.length} real testnet issues, ${seriesMeta.length} series and ${art.size} images; receipts verified.`);
db.close();
