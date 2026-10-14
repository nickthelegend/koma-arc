/** Read-only route/interaction audit at both required widths. Defaults to public Vercel.
 * KOMA_URL=http://localhost:8610 node scripts/e2e-browser-koma.mjs */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.KOMA_URL||'https://koma-arc.vercel.app';
const out=process.env.KOMA_SHOTS||'docs/screens/testnet/round2';mkdirSync(out,{recursive:true});
const get=async p=>{const r=await fetch(base+p,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`${p}: ${r.status}`);return r.json();};
const status=await get('/api/status');if(status.chainId!==5042002)throw Error('Expected Arc testnet');
const {comics}=await get('/api/comics');const {series}=await get('/api/series');
const c=comics[0],s=series[0];
const routes=['/','/series','/series?tab=graduated','/launch','/create','/create/form','/search','/shelf','/receipts','/how','/room','/fund',...(s?[`/s/${s.id}`,`/embed/s/${s.id}`,`/creator/${s.creator}`]:[]),...(c?[`/c/${c.id}`,`/c/${c.id}/read`,`/tx/${c.chain.paymentTx}`]:[])];
const results=[];const browser=await chromium.launch();
try {
 for(const width of (process.env.KOMA_WIDTHS||"1440,390").split(",").map(Number)){
 const context=await browser.newContext({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1});context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(90000);
 for(const route of (process.env.KOMA_INTERACTIONS_ONLY === "1" ? [] : routes)){
 const page=await context.newPage(),errors=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)failed.push({url:r.url().replace(base,''),status:r.status()});});
 const response=await page.goto(base+route,{waitUntil:'networkidle',timeout:90000});await page.waitForTimeout(1200);
 const scan=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth-innerWidth,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src),links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))}));
 const stale=/\b(monad|AUSD|lorem ipsum)\b/i.test(scan.text);
 const badLinks=scan.links.filter(h=>/localhost|arcscan|explorer\.arc\.io/.test(h));
 const name=route==='/'?'home':route.replace(/[^a-z0-9]+/gi,'-');
 await page.screenshot({path:`${out}/${width}-${name}.jpg`,type:'jpeg',quality:75,fullPage:true});
 const row={width,route,status:response.status(),errors,failed,overflow:scan.overflow,broken:scan.broken,badLinks,stale};
 row.ok=row.status===200&&!errors.length&&!failed.length&&scan.overflow<=1&&!scan.broken.length&&!badLinks.length&&!stale;
 results.push(row);console.log(`${row.ok?'PASS':'FAIL'} ${width} ${route}${row.ok?'':' '+JSON.stringify(row)}`);
 await page.close();
 }
 // Exercise real navigation and form controls, without requesting payments.
 const p=await context.newPage();await p.goto(base+'/create/form',{waitUntil:'networkidle'});
 await p.getByRole('button',{name:'Heist gone wrong',exact:true}).click();
 results.push({width,interaction:'story starter',ok:/Four broke crooks/.test(await p.getByLabel('What happens in your comic?').inputValue())});
 if(!status.ready){results.push({width,interaction:'unavailable before payment',ok:await p.getByText('Generation unavailable.',{exact:true}).isVisible()&&await p.getByRole('button',{name:/^Pay /}).first().isDisabled()});}
 await p.goto(base+'/series',{waitUntil:'networkidle'});if(s){await p.locator(`a[href="/s/${s.id}"]`).first().click();await p.waitForURL(u=>u.pathname===`/s/${s.id}`);results.push({width,interaction:'open series from catalog',ok:true});}
 if(c){await p.goto(base+`/c/${c.id}`,{waitUntil:'networkidle'});const link=p.locator(`a[href="/c/${c.id}/read"]`).first();await link.click();await p.waitForURL(u=>u.pathname===`/c/${c.id}/read`);results.push({width,interaction:'open comic reader',ok:true});}
 await context.close();
 }
 // Simulated network failure only tests the unavailable state; never presented as chain evidence.
 const p=await browser.newPage();await p.route('**/api/status',r=>r.abort('failed'));await p.goto(base+'/create/form',{waitUntil:'networkidle'});await p.getByText(/Could not reach the studio/).waitFor();
 results.push({interaction:'status network failure blocks payment',ok:await p.getByRole('button',{name:/^Pay /}).first().isDisabled()});await p.close();
} catch(e){results.push({ok:false,error:e.message});console.error(e.message);}
finally{await browser.close();writeFileSync(out+'/results.json',JSON.stringify({at:new Date().toISOString(),base,chainId:status.chainId,results},null,2)+'\n');}
console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);if(results.some(r=>!r.ok))process.exitCode=1;
