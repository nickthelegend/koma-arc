import {hashTypedData} from 'viem';
import {burnIntentTypedData,type BurnIntent,type GatewayNetwork} from './gateway';
/** Separate, non-financial proof: never accepted by GatewayWallet or gatewayMint. */
export function gatewayRecoveryProof(g:GatewayNetwork,intent:BurnIntent,issuedAt:bigint){
 return {domain:{name:'KOMA Gateway Read Recovery',version:'1',chainId:5042002,verifyingContract:g.minter},types:{GatewayRecoveryRead:[{name:'intentHash',type:'bytes32'},{name:'issuedAt',type:'uint64'},{name:'purpose',type:'string'}]},primaryType:'GatewayRecoveryRead',message:{intentHash:hashTypedData(burnIntentTypedData(intent)),issuedAt,purpose:'Read original transfer only. No transfer, mint or provisioning authorization.'}} as const;
}
export function recoveryIssuedAt(raw:unknown,nowSeconds:number):bigint{
 if(typeof raw!=='string'||!/^\d{1,12}$/.test(raw))throw Error('Read recovery proof time is missing.');
 const n=Number(raw);if(!Number.isSafeInteger(n)||n>nowSeconds+15||n<nowSeconds-120)throw Error('Read recovery proof expired. Sign a new read-only proof.');return BigInt(n);
}
