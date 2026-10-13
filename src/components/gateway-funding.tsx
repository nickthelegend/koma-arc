"use client";
import {useState} from 'react';
import {decodeFunctionData,formatUnits,getAddress,isHex,keccak256,type Hex} from 'viem';
import {useWallet} from './wallet';
import {KOMA} from '@/lib/network';
import {lpClient} from '@/lib/launchpad/client';
import {gatewayFor,burnIntentFromJson,burnIntentToJson,burnIntentTypedData,GATEWAY_MINTER_ABI} from '@/lib/gateway';
import {matchesGatewayMint} from '@/lib/gateway-mint-evidence';
import {gatewayBackupKey,parseGatewayBackup,saveGatewayBackup,clearGatewayBackup,type GatewayBackup} from '@/lib/gateway-recovery';
import {gatewayRecoveryProof} from '@/lib/gateway-recovery-proof';
import {withOriginTransactionLock} from '@/lib/origin-transaction-lock';
type Attestation={attestation:Hex;signature:Hex;transferId?:string;transactionHash?:Hex};
async function request(body:unknown){const r=await fetch('/api/gateway',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error??'Gateway is unavailable.');return data;}
export function GatewayFunding(){
 const wallet=useWallet();const g=gatewayFor('testnet');
 const [source,setSource]=useState(g.sources[0].domain),[amount,setAmount]=useState('');
 const [quote,setQuote]=useState<{owner:string;intent:ReturnType<typeof burnIntentFromJson>}|null>(null);
 const [saved,setSaved]=useState<GatewayBackup|null>(null),[transferId,setTransferId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const current=saved?.owner.toLowerCase()===wallet.address?.toLowerCase()?saved:null;
 const currentQuote=quote?.owner.toLowerCase()===wallet.address?.toLowerCase()?quote:null;
 const persist=(p:GatewayBackup)=>{const next=saveGatewayBackup(localStorage,p);setSaved(next);return next;};
 const restore=()=>{if(!wallet.address)throw Error('Connect the original wallet.');const p=parseGatewayBackup(localStorage.getItem(gatewayBackupKey(KOMA.chain.id,wallet.address)),KOMA.chain.id,wallet.address);setSaved(p);return p;};
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await withOriginTransactionLock('koma:pending-trade',async()=>{if(KOMA.chain.id!==5042002)throw Error('Gateway recovery requires Arc testnet 5042002.');await fn();});}catch(e){setMessage(e instanceof Error?e.message:'Funding is unavailable.');}finally{setBusy(false);}};
 const original=(p:GatewayBackup)=>{const actual=restore();if(JSON.stringify(actual)!==JSON.stringify(p))throw Error('Original transfer changed in another tab. Restore its current journal before continuing.');return actual;};
 const recoverAttestation=async(p:GatewayBackup):Promise<{pending:GatewayBackup;result:Attestation}>=>{
  if(p.stage==='unsigned')throw Error('Signing was interrupted before any Gateway submission. No signature is stored; genuine wallet/provider history or manual review is required before a new authorization.');
  const reader=await wallet.walletClient();if(getAddress(reader.account.address)!==getAddress(p.owner)||await reader.getChainId()!==p.chainId)throw Error('Reconnect the original depositor on Arc testnet for read-only recovery.');
  // eslint-disable-next-line react-hooks/purity -- runs inside an async event handler, never during render
  const issuedAt=BigInt(Math.floor(Date.now()/1000));
  const recoverySignature=await reader.signTypedData({account:reader.account,...gatewayRecoveryProof(g,burnIntentFromJson(g,p.burnIntent),issuedAt)});
  const result:Attestation=await request({action:'recover',burnIntent:p.burnIntent,transferId:p.transferId||transferId||undefined,issuedAt:issuedAt.toString(),recoverySignature});
  if(!result.attestation||!result.signature)throw Error('Original attestation is unavailable. No transfer was resubmitted.');
  if(p.transferId&&result.transferId&&p.transferId!==result.transferId)throw Error('Original Circle transfer ID changed.');
  if(p.mintHash&&result.transactionHash&&p.mintHash.toLowerCase()!==result.transactionHash.toLowerCase())throw Error('Original mint hash changed.');
  if(result.transactionHash!==undefined&&(!isHex(result.transactionHash)||result.transactionHash.length!==66))throw Error('Circle returned an invalid original mint hash.');
  const next={...p,stage:result.transactionHash?'mint-submitted' as const:p.stage==='attesting'?'attested' as const:p.stage,attestationHash:keccak256(result.attestation),attestationSignatureHash:keccak256(result.signature),transferId:p.transferId||result.transferId,mintHash:p.mintHash||result.transactionHash};
  return {pending:persist(next),result};
 };
 const verifyMint=async(p:GatewayBackup)=>{
  if(!p.mintHash)throw Error('Mint submission has no known original hash. Genuine wallet/provider history is required; no second mint was requested.');
  const hash=p.mintHash;const [r,tx,final,chain]=await Promise.all([lpClient.getTransactionReceipt({hash}),lpClient.getTransaction({hash}),lpClient.getBlock({blockTag:'finalized'}),lpClient.getChainId()]);
  const canonical=await lpClient.getBlock({blockNumber:r.blockNumber});
  if(chain!==p.chainId||r.transactionHash.toLowerCase()!==hash.toLowerCase()||tx.hash.toLowerCase()!==hash.toLowerCase()||tx.from.toLowerCase()!==p.owner.toLowerCase()||r.from.toLowerCase()!==p.owner.toLowerCase()||tx.to?.toLowerCase()!==g.minter.toLowerCase()||r.to?.toLowerCase()!==g.minter.toLowerCase()||tx.value!==BigInt(0)||tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber||canonical.hash!==r.blockHash||final.number===null||final.number<r.blockNumber)throw Error('Original mint has no exact canonical finalized transaction proof.');
  const call=decodeFunctionData({abi:GATEWAY_MINTER_ABI,data:tx.input});
  const code=await lpClient.getBytecode({address:g.minter,blockNumber:r.blockNumber});
  if(call.functionName!=='gatewayMint'||keccak256(call.args[0])!==p.attestationHash||keccak256(call.args[1])!==p.attestationSignatureHash||!code||code==='0x')throw Error('Original mint call differs from the saved attestation.');
  if(r.status!=='success')throw Error('Original mint finalized as reverted. Its original receipt is retained; no automatic retry is allowed.');
  if(!matchesGatewayMint(r,hash,g,burnIntentFromJson(g,p.burnIntent)))throw Error('Original receipt does not prove the exact Gateway transfer.');
  clearGatewayBackup(localStorage,p);setSaved(null);setQuote(null);wallet.refreshBalance();setMessage('USDC arrived in your Arc wallet.');
 };
 return <section className="mt-6 space-y-5 text-paper">
 <p className="text-soft">Transfer previously deposited Circle Gateway USDC to the same wallet on Arc. Keep USDC on Arc for the mint gas fee.</p>
 <a className="underline" href="https://developers.circle.com/gateway/howtos/transfer-unified-usdc-balance" target="_blank" rel="noreferrer">How to deposit into Gateway</a>
 {!wallet.address?<button onClick={wallet.connect} disabled={wallet.connecting}>Connect wallet</button>:<>
 <button disabled={busy} className="underline" onClick={()=>run(async()=>{restore();setMessage('Original public transfer journal restored. Check its original outcome below.');})}>Resume a saved transfer</button>
 <label className="block">Deposit network<select className="ml-3 bg-stock p-2" value={source} disabled={busy||!!current} onChange={e=>{setSource(Number(e.target.value));setQuote(null);}}>{g.sources.map(s=><option key={s.domain} value={s.domain}>{s.name}</option>)}</select></label>
 <label className="block">USDC amount<input className="ml-3 w-40 bg-stock p-2" value={amount} inputMode="decimal" disabled={busy||!!current} onChange={e=>{setAmount(e.target.value);setQuote(null);}}/></label>
 {!current&&<button disabled={busy} onClick={()=>run(async()=>{const owner=wallet.address!;if(localStorage.getItem(gatewayBackupKey(KOMA.chain.id,owner))){restore();throw Error('Resume the original transfer first.');}setQuote(null);const r=await request({action:'quote',address:owner,sourceDomain:source,amount});setQuote({owner,intent:burnIntentFromJson(g,r.burnIntent)});})}>Get fee quote</button>}
 {currentQuote&&!current&&<div><p>Receive {formatUnits(currentQuote.intent.spec.value,6)} USDC. Maximum Gateway fee: {formatUnits(currentQuote.intent.maxFee,6)} USDC.</p><button disabled={busy} onClick={()=>run(async()=>{
  const owner=wallet.address!;if(localStorage.getItem(gatewayBackupKey(KOMA.chain.id,owner))){restore();throw Error('Resume the original transfer first.');}
  let p:GatewayBackup=persist({version:2,owner,chainId:KOMA.chain.id,burnIntent:burnIntentToJson(currentQuote.intent),stage:'unsigned'});let handedOff=false;
  try{const w=await wallet.walletClient();if(getAddress(w.account.address)!==getAddress(owner)||await w.getChainId()!==KOMA.chain.id)throw Error('Wallet or network changed.');
   const signature=await w.signTypedData({account:w.account,...burnIntentTypedData(currentQuote.intent)});
   if(getAddress(w.account.address)!==getAddress(owner)||await w.getChainId()!==KOMA.chain.id)throw Error('Wallet or network changed before Gateway submission.');
   p=persist({...p,stage:'attesting',ownerSignatureHash:keccak256(signature)});handedOff=true;
   const r:Attestation=await request({action:'attest',burnIntent:p.burnIntent,signature});
   persist({...p,stage:'attested',transferId:r.transferId,attestationHash:keccak256(r.attestation),attestationSignatureHash:keccak256(r.signature)});setMessage('Original transfer accepted. Mint is not yet verified.');
  }catch(e){if(!handedOff&&p.stage==='unsigned'){clearGatewayBackup(localStorage,p);setSaved(null);}throw e;}
 })}>Authorize transfer in wallet</button></div>}
 {current&&<><p>Original stage: {current.stage}. Unknown submissions remain locked.</p><label>Original Circle transfer ID<input className="block w-full bg-stock p-2" value={transferId} onChange={e=>setTransferId(e.target.value)}/></label>
 <button disabled={busy} onClick={()=>run(async()=>{let p=original(current);if(p.mintHash){await verifyMint(p);return;}if(p.stage==='mint-submitting')throw Error('Original mint has no hash. Genuine wallet/provider history is required; no retry was requested.');p=(await recoverAttestation(p)).pending;setMessage(`Original transfer recovered (${p.stage}). No mint was submitted.`);})}>Check original outcome (read-only wallet proof)</button>
 {current.stage==='attested'&&<button disabled={busy} onClick={()=>run(async()=>{const {pending:p,result}=await recoverAttestation(original(current));if(p.stage!=='attested'||p.mintHash)throw Error('An original mint outcome is already recorded. Check its receipt; no new mint was requested.');const w=await wallet.walletClient();if(getAddress(w.account.address)!==getAddress(p.owner)||await w.getChainId()!==p.chainId)throw Error('Reconnect the original wallet on Arc testnet.');let next=persist({...p,stage:'mint-submitting'});const hash=await w.writeContract({account:w.account,chain:KOMA.chain,address:g.minter,abi:GATEWAY_MINTER_ABI,functionName:'gatewayMint',args:[result.attestation,result.signature]});next=persist({...next,stage:'mint-submitted',mintHash:hash});await lpClient.waitForTransactionReceipt({hash});await verifyMint(next);})}>Mint USDC on Arc</button>}
 <button className="underline" onClick={()=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));a.href=url;a.download='koma-gateway-public-journal.json';a.click();URL.revokeObjectURL(url);}}>Save public recovery journal</button></>}
 </>}
 {(message||wallet.error)&&<p role="status" className="break-words text-soft">{busy?'Waiting… ':''}{message||wallet.error}</p>}
 </section>;
}
