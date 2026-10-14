/** Verify original video artifacts using chain reads only. No generation/signing. */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPublicClient,http,parseAbi,parseEventLogs} from 'viem';
const client=createPublicClient({transport:http('https://rpc.mainnet.arc.io')});
assert.equal(await client.getChainId(),5042);
const d=JSON.parse(readFileSync('deployments/arc-mainnet.json','utf8'));
const db=new DatabaseSync(path.resolve(process.env.KOMA_DATA_DIR||'../video/.tmp/koma-B-data','koma.db'),{readOnly:true});
const comics=db.prepare('SELECT data FROM issues ORDER BY created_at DESC').all().map(r=>JSON.parse(r.data));
const abi=parseAbi(['event IssueMinted(uint256 indexed tokenId,address indexed to,bytes32 indexed paymentTx,bytes32 contentHash,uint256 remixOf,uint16 pages)','function ownerOf(uint256) view returns(address)']);
for(const c of comics){
 assert.equal(c.chain.network,'arc');assert.equal(c.chain.contract.toLowerCase(),d.komaIssues.toLowerCase());
 const mint=await client.getTransactionReceipt({hash:c.chain.mintTx});const paid=await client.getTransactionReceipt({hash:c.chain.paymentTx});
 assert.equal(mint.status,'success');assert.equal(paid.status,'success');
 const e=parseEventLogs({abi,logs:mint.logs,eventName:'IssueMinted'}).find(l=>l.address.toLowerCase()===d.komaIssues.toLowerCase()&&Number(l.args.tokenId)===c.chain.tokenId);
 assert(e);assert.equal(e.args.contentHash,c.chain.contentHash);assert.equal(e.args.paymentTx,c.chain.paymentTx);
 assert.equal((await client.readContract({address:d.komaIssues,abi,functionName:'ownerOf',args:[BigInt(c.chain.tokenId)]})).toLowerCase(),c.creator.address.toLowerCase());
}
const seriesMeta=db.prepare('SELECT * FROM lp_series_meta').all();
for(const m of seriesMeta)await client.readContract({address:d.characterNft,abi,functionName:'ownerOf',args:[BigInt(m.id)]});
const art=new Set();
function rewrite(x){
 if(typeof x==='string'&&/^\/(archive\/testnet|api)\/art\/[a-z0-9-]+\/[a-z0-9-]+\.jpg$/.test(x)){
  const original=x.replace('/api/art/','/archive/testnet/art/');art.add(original);return original.replace('/testnet/','/mainnet/');
 }
 if(Array.isArray(x))return x.map(rewrite);
 if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,rewrite(v)]));return x;
}
const out=rewrite({chainId:5042,verifiedAt:new Date().toISOString(),provenance:'Original video artifacts; existing AI artwork reused. Mint/payment receipts and ownership verified; no paid API calls.',comics,seriesMeta});
for(const src of art){const dest=path.join('public',src.replace('/testnet/','/mainnet/'));mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(path.join('public',src),dest);}
writeFileSync('deployments/hosted-comics-mainnet.json',JSON.stringify(out,null,2)+'\n');db.close();
console.log(`Verified ${comics.length} mainnet comics, ${seriesMeta.length} series, ${art.size} existing images`);
