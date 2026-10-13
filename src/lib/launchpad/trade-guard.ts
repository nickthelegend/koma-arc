export class UnconfirmedTradeError extends Error {
 readonly hash:string;
 constructor(hash:string){super('Transaction outcome is unknown. Check its receipt before submitting another trade.');this.hash=hash;this.name='UnconfirmedTradeError';}
}
export function requireTradeWallet(actual:string,expected:string):void {if(actual.toLowerCase()!==expected.toLowerCase())throw new Error('The wallet changed while preparing this trade. Review the amount with the current wallet.');}
