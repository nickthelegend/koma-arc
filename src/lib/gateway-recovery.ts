import {getAddress,isHex,type Hex} from 'viem';
import {burnIntentFromJson,burnIntentToJson,burnIntentDepositor,burnIntentRecipient,gatewayFor} from './gateway';
export type GatewayBackup={version:2;owner:string;chainId:number;burnIntent:unknown;stage:'unsigned'|'attesting'|'attested'|'mint-submitting'|'mint-submitted';ownerSignatureHash?:Hex;attestationHash?:Hex;attestationSignatureHash?:Hex;transferId?:string;mintHash?:Hex};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function gatewayBackupKey(chainId:number,owner:string){return `koma-gateway:${chainId}:${getAddress(owner).toLowerCase()}`;}
const stages=['unsigned','attesting','attested','mint-submitting','mint-submitted'];
export function parseGatewayBackup(raw:string|null,chainId:number,owner:string):GatewayBackup{
 const p=JSON.parse(raw??'null') as GatewayBackup|null;
 if(!p||p.version!==2||chainId!==5042002||p.chainId!==chainId||getAddress(p.owner)!==getAddress(owner)||!stages.includes(p.stage))throw Error('Original Gateway journal is missing or uses a legacy authorization backup. New submissions are blocked; retain the original private recovery information.');
 const intent=burnIntentFromJson(gatewayFor('testnet'),p.burnIntent);
 if(burnIntentDepositor(intent)!==getAddress(owner)||burnIntentRecipient(intent)!==getAddress(owner))throw Error('Original Gateway owner or recipient differs.');
 for(const h of [p.ownerSignatureHash,p.attestationHash,p.attestationSignatureHash,p.mintHash])if(h!==undefined&&(!isHex(h)||h.length!==66))throw Error('Invalid original Gateway digest or hash.');
 if(p.transferId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.transferId))throw Error('Invalid original transfer ID.');
 if(p.stage!=='unsigned'&&!p.ownerSignatureHash)throw Error('Original authorization digest is unavailable.');
 if(['attested','mint-submitting','mint-submitted'].includes(p.stage)&&(!p.attestationHash||!p.attestationSignatureHash))throw Error('Original attestation digests are unavailable.');
 if(p.stage==='mint-submitted'&&!p.mintHash)throw Error('Original mint hash is unavailable.');
 return {version:2,owner:p.owner,chainId:p.chainId,burnIntent:burnIntentToJson(intent),stage:p.stage,ownerSignatureHash:p.ownerSignatureHash,attestationHash:p.attestationHash,attestationSignatureHash:p.attestationSignatureHash,transferId:p.transferId,mintHash:p.mintHash};
}
export function saveGatewayBackup(s:Store,p:GatewayBackup){
 const raw=s.getItem(gatewayBackupKey(p.chainId,p.owner));const old=raw===null?null:parseGatewayBackup(raw,p.chainId,p.owner);const next=parseGatewayBackup(JSON.stringify(p),p.chainId,p.owner);
 if(old){for(const f of ['owner','chainId','burnIntent','ownerSignatureHash','attestationHash','attestationSignatureHash','transferId','mintHash'] as const){const a=old[f],b=next[f];if(a!==undefined&&JSON.stringify(a)!==JSON.stringify(b))throw Error('Original Gateway identity cannot be replaced.');}if(stages.indexOf(next.stage)<stages.indexOf(old.stage))throw Error('Original Gateway stage cannot be reversed.');}
 const encoded=JSON.stringify(next);s.setItem(gatewayBackupKey(p.chainId,p.owner),encoded);if(s.getItem(gatewayBackupKey(p.chainId,p.owner))!==encoded)throw Error('Gateway journal was not saved reliably. Submission is blocked.');return next;
}
export function clearGatewayBackup(s:Store,p:GatewayBackup){const k=gatewayBackupKey(p.chainId,p.owner);const old=parseGatewayBackup(s.getItem(k),p.chainId,p.owner);if(JSON.stringify(old)!==JSON.stringify(parseGatewayBackup(JSON.stringify(p),p.chainId,p.owner)))throw Error('Original Gateway identity changed.');s.removeItem(k);if(s.getItem(k)!==null)throw Error('Original Gateway journal could not be cleared.');}
