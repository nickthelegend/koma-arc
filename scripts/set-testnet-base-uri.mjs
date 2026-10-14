/** Update both TESTNET NFTs to a verified hosted origin. Never targets mainnet.
 * KOMA_PUBLIC_URL=https://koma-arc.vercel.app node scripts/set-testnet-base-uri.mjs */
import {readFileSync,mkdirSync,rmdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,parseAbi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {readEnv} from './lib/usdc.mjs';
const origin=new URL(process.env.KOMA_PUBLIC_URL||'https://koma-arc.vercel.app');
assert.equal(origin.protocol,'https:');assert.equal(origin.pathname,'/');
const base=origin.origin;
const d=JSON.parse(readFileSync('deployments/arc-testnet.json','utf8'));assert.equal(d.chainId,5042002);
const rpc='https://rpc.testnet.arc.io';const chain={id:5042002,name:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:[rpc]}}};
const c=createPublicClient({chain,transport:http(rpc)});assert.equal(await c.getChainId(),5042002);
const status=await fetch(base+'/api/status').then(r=>r.json());assert.equal(status.chainId,5042002);
const account=privateKeyToAccount(readEnv('../.deployer/deployer.env').DEPLOYER_PRIVATE_KEY);assert.equal(account.address.toLowerCase(),d.admin.toLowerCase());
const w=createWalletClient({chain,account,transport:http(rpc)});
const abi=parseAbi(['function setBaseURI(string)','function tokenURI(uint256) view returns (string)']);
const results=[];
for(const [address,path] of [[d.komaIssues,'tokens'],[d.characterNft,'characters']]){
 const uri=`${base}/api/${path}/`;
 const response=await fetch(uri+'1');assert.equal(response.status,200);const metadata=await response.json();
 assert.ok(metadata.image?.startsWith(base+'/'));const image=await fetch(metadata.image);assert.equal(image.status,200);assert.ok(image.headers.get('content-type')?.startsWith('image/'));
 const before=await c.readContract({address,abi,functionName:'tokenURI',args:[1n]});
 if(before===uri+'1'){results.push({address,uri,unchanged:true});continue;}
 const lock='../.deployer/lock';let locked=false;
 try{for(let i=0;i<120;i++){try{mkdirSync(lock);locked=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}}assert.ok(locked,'Deployer lock unavailable');
 const gas=await c.estimateContractGas({address,abi,functionName:'setBaseURI',args:[uri],account});assert.ok(gas*(await c.getGasPrice())<10n**17n,'Fee exceeds 0.1 USDC');
 const hash=await w.writeContract({address,abi,functionName:'setBaseURI',args:[uri]});const receipt=await c.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');
 assert.equal(await c.readContract({address,abi,functionName:'tokenURI',args:[1n]}),uri+'1');
 results.push({address,before,uri,hash,gasUsed:String(receipt.gasUsed),feeUsdc:Number(receipt.gasUsed*receipt.effectiveGasPrice)/1e18});
 }finally{if(locked)rmdirSync(lock);}
}
writeFileSync('docs/screens/testnet/base-uri-results.json',JSON.stringify({at:new Date().toISOString(),chainId:5042002,results},null,2)+'\n');console.log(JSON.stringify(results,null,2));
