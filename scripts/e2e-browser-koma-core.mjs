/** Real browser x402 → AI art → mint → reader on Arc TESTNET only.
 * KOMA_URL=http://localhost:8610 node scripts/e2e-browser-koma-core.mjs
 * Funds 0.25 USDC under the shared deployer lock; keys stay in ignored .env.round2.
 * Sweep is attempted in finally; no launch/trade suites with >1 USDC requirements run. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,rmdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createPublicClient,createWalletClient,http,parseEther,formatEther,parseAbi} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {installWallet} from './lib/wallet-shim.mjs';
import {readEnv} from './lib/usdc.mjs';
const base=process.env.KOMA_URL||'http://localhost:8610';
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):86\d\d$/.test(base),'Core test requires the local studio on a Koma port');
const rpc='https://rpc.testnet.arc.io';
const chain={id:5042002,name:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:[rpc]}}};
const client=createPublicClient({chain,transport:http(rpc)});assert.equal(await client.getChainId(),5042002);
const status=await fetch(base+'/api/status').then(r=>r.json());assert.equal(status.chainId,5042002);assert.equal(status.ready,true);assert.equal(status.ai.ok,true);
const keyfile='.env.round2';if(!existsSync(keyfile))writeFileSync(keyfile,`BROWSER_KEY=${generatePrivateKey()}\n`,{mode:0o600});
const account=privateKeyToAccount(readEnv(keyfile).BROWSER_KEY);
const wallet=createWalletClient({chain,account,transport:http(rpc)});
const deployer=privateKeyToAccount(readEnv('../.deployer/deployer.env').DEPLOYER_PRIVATE_KEY);
const funder=createWalletClient({chain,account:deployer,transport:http(rpc)});
const output={at:new Date().toISOString(),network:'Live (testnet)',wallet:account.address,transactions:{},checks:[]};
const out='docs/screens/testnet';mkdirSync(out,{recursive:true});
let browser;
try {
 const lock='../.deployer/lock';let locked=false;
 try {for(let i=0;i<120;i++){try{mkdirSync(lock);locked=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}}assert.ok(locked,'Deployer lock unavailable');
 output.transactions.fund=await funder.sendTransaction({to:account.address,value:parseEther('0.25')});
 assert.equal((await client.waitForTransactionReceipt({hash:output.transactions.fund})).status,'success');
 } finally {if(locked)rmdirSync(lock);}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(90000);
 await installWallet(page,readEnv(keyfile).BROWSER_KEY,{rpc,chainId:5042002});
 await page.goto(base+'/create/form',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();
 await page.getByLabel('What happens in your comic?').fill('A tiny robot lighthouse keeper guides a lost paper boat through a midnight storm. A warm, hopeful ending.');
 await page.getByRole('radio',{name:'1 page · $0.10',exact:true}).click();
 const pay=page.getByRole('button',{name:'Pay 0.10 USDC & draw',exact:true});await pay.waitFor();await pay.click();
 const sign=page.getByRole('button',{name:/^Sign & pay/});await sign.waitFor();await sign.click();
 await page.waitForURL(/job=/,{timeout:60000});output.jobId=new URL(page.url()).searchParams.get('job');
 await page.screenshot({path:out+'/core-paid.png',fullPage:true});
 const read=page.getByRole('link',{name:'Read it',exact:true}).first();
 await read.waitFor({timeout:650000});
 output.issueUrl=await read.getAttribute('href');
 await page.screenshot({path:out+'/core-minted.png',fullPage:true});
 const comic=(await fetch(base+'/api/comics').then(r=>r.json())).comics.find(c=>c.id===output.jobId);
 assert.ok(comic?.chain?.tokenId);output.transactions.payment=comic.chain.paymentTx;output.transactions.mint=comic.chain.mintTx;output.tokenId=comic.chain.tokenId;
 for(const name of ['payment','mint'])assert.equal((await client.getTransactionReceipt({hash:output.transactions[name]})).status,'success');
 const lp=JSON.parse(readFileSync('deployments/arc-testnet.json','utf8'));
 assert.equal((await client.readContract({address:lp.komaIssues,abi:parseAbi(['function ownerOf(uint256) view returns (address)']),functionName:'ownerOf',args:[BigInt(output.tokenId)]})).toLowerCase(),account.address.toLowerCase());
 await read.click();await page.waitForURL(u=>u.pathname===output.issueUrl);await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&!i.naturalWidth).length),0);
 await page.screenshot({path:out+'/core-reader.png',fullPage:true});
 output.checks.push('UI wallet connection','one-page 0.10 USDC quote','real EIP-3009 browser signature','confirmed x402 payment','real AI script and art','confirmed NFT mint and ownership','reader images loaded');
 output.ok=true;
} catch(e){output.ok=false;output.error=e.message;console.error(e.message);}
finally {
 if(browser)await browser.close();
 try {const balance=await client.getBalance({address:account.address});const gasPrice=await client.getGasPrice();const gas=await client.estimateGas({account:account.address,to:deployer.address,value:1n});const value=balance-gas*gasPrice;
 if(value>0n){output.transactions.sweep=await wallet.sendTransaction({to:deployer.address,value,gas,gasPrice});assert.equal((await client.waitForTransactionReceipt({hash:output.transactions.sweep})).status,'success');}
 output.remainingUsdc=formatEther(await client.getBalance({address:account.address}));
 }catch(e){output.sweepError=e.shortMessage||e.message;}
 writeFileSync(out+'/core-results.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
}
if(!output.ok||output.sweepError)process.exitCode=1;
