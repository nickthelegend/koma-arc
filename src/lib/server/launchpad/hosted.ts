import { indexOnce } from './indexer';
let pending: Promise<unknown> | undefined;
let checkedAt = 0;
/** Reconstructable read cache only. No keeper or background work on Vercel. */
export async function refreshHostedIndex() {
 if(process.env.KOMA_HOSTED_READ_ONLY !== '1' || Date.now()-checkedAt<60000) return;
 if(!pending) pending=indexOnce().then(()=>{checkedAt=Date.now()}).finally(()=>{pending=undefined});
 await pending;
}
