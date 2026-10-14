// Live testnet only; one 0.10-USDC payment. Never logs signatures or keys.
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {wrapFetchWithPayment} from '@x402/fetch';
import {x402Client} from '@x402/core/client';
import {x402HTTPClient} from '@x402/core/http';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import {privateKeyToAccount} from 'viem/accounts';
const base=process.env.KOMA_URL||'https://app-production-758c.up.railway.app';
const file=new URL('../docs/screens/hosted/action.json',import.meta.url);
const status=await(await fetch(`${base}/api/status`)).json();
if(status.chainId!==5042002||!status.ready||!status.ai.ok)throw Error('Hosted testnet/AI not ready');
let result=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
if(!result){
 const account=privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
 const client=x402Client.fromConfig({schemes:[{network:'eip155:5042002',client:new ExactEvmScheme(account)}],spendControls:{allowedAssets:[{network:'eip155:5042002',asset:status.usdc,maxAmountPerPayment:'100000'}]}});
 const res=await wrapFetchWithPayment(fetch,client)(`${base}/api/comics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'An astronaut courier delivers a tiny glowing library to a lonely moon robot. A warm funny story with a clear ending.',pages:1,style:'pop-art'})});
 const body=await res.json();if(res.status!==202)throw Error(`Comic request ${res.status}: ${JSON.stringify(body)}`);
 const settlement=new x402HTTPClient(client).getPaymentSettleResponse(n=>res.headers.get(n));
 result={network:'Live Arc testnet',base,amountUSDC:0.1,jobId:body.jobId,paymentTx:settlement?.transaction};
 writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
for(let i=0;i<200;i++){
 const job=await(await fetch(`${base}/api/jobs/${result.jobId}`)).json();
 if(job.stage==='done'||job.stage==='error'){
  Object.assign(result,{stage:job.stage,mintTx:job.mintTx,tokenId:job.tokenId,error:job.error,issue:`${base}/c/${job.id}`});writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exit(job.stage==='done'?0:1);
 }
 if(i%10===0)console.log(`Job ${result.jobId}: ${job.stage}`);
 await new Promise(r=>setTimeout(r,3000));
}
throw Error('Job still running; rerun to resume polling without another payment');
