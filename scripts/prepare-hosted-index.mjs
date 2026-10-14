/** Rebuild only public on-chain cache tables from live testnet; never loads a signer. */
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
mkdirSync('.vercel',{recursive:true});
const dir=mkdtempSync(path.resolve('.vercel/index-'));
const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
import fs from 'node:fs';
const {indexOnce}=await import('./src/lib/server/launchpad/indexer.ts').then(m=>m.default??m);
const {db}=await import('./src/lib/server/launchpad/db.ts').then(m=>m.default??m);
const block=await indexOnce();
const names=['lp_meta','lp_series','lp_balances','lp_trades','lp_slots','lp_routed','lp_proposals'];
const tables={};
for(const name of names){
 const columns=db().prepare('PRAGMA table_info('+name+')').all().map(r=>r.name);
 if(!columns.length)continue;
 const rows=db().prepare('SELECT * FROM '+name).all().map(row=>columns.map(c=>row[c]));
 tables[name]={columns,rows};
}
fs.writeFileSync('deployments/hosted-index-testnet.json',JSON.stringify({chainId:5042002,indexedAt:new Date().toISOString(),block:String(block),tables},null,2)+'\\n');
console.log('Live testnet chain cache:',String(block),'series:',tables.lp_series.rows.length);
`],{stdio:'inherit',env:{...process.env,SERVER_PRIVATE_KEY:'',NEXT_PUBLIC_KOMA_NETWORK:'arc-testnet',KOMA_HOSTED_READ_ONLY:'0',KOMA_DATA_DIR:dir,KOMA_SERVER_RPC_URL:'https://rpc.blockdaemon.testnet.arc.io',KOMA_INDEX_CHUNK:'5000'}});
rmSync(dir,{recursive:true,force:true});process.exit(result.status??1);
