import * as c from './dryrun-common.mjs';
await c.run('koma',async()=>{
 const n='koma',d=c.load(n);
 const {komaAbi:ia}=await import('../src/lib/koma-abi.ts');
 const {factoryAbi:fa,curveAbi:ba,sellTypes}=await import('../src/lib/launchpad/abi.ts');
 const {buyNonce}=await import('../src/lib/launchpad/intents.ts');
 c.roleKey('relayer','koma','SERVER_PRIVATE_KEY',d.relayer);
 for(const role of ['buyer','relayer'])await c.fund(n,role);
 const u=await c.auth('buyer',d.treasury,200000n);
 const payment=await c.write(n,'x402 issue payment 0.2 USDC','relayer',c.USDC,c.erc,'transferWithAuthorization',[u.from,u.to,u.value,u.validAfter,u.validBefore,u.nonce,u.v,u.r,u.s]);
 await c.write(n,'mint paid issue','relayer',d.komaIssues,ia,'mint',[c.roles.buyer,c.keccak256(c.toHex('Dryrun comic')),payment.transactionHash,2,0n]);
 const seriesId=await c.read(d.seriesFactory,fa,'seriesCount')+1n;
 await c.write(n,'series launch','relayer',d.seriesFactory,fa,'launch',[{creator:c.roles.buyer,name:'Dryrun Lighthouse',symbol:'DRY',characterName:'Mira',sheetHash:c.keccak256(c.toHex('Mira')),parentSeriesId:0n,graduationTarget:1000000000n,votingWindow:3600n}]);
 const series=await c.read(d.seriesFactory,fa,'series',[seriesId]);
 const deadline=(await c.pub.getBlock()).timestamp+1800n,salt=c.keccak256(c.toHex(c.roles.buyer));
 const nonce=buyNonce({curve:series.curve,buyer:c.roles.buyer,usdcIn:2500000n,minCoinOut:0n,deadline,salt});
 if(nonce!==await c.read(series.curve,c.parseAbi(['function buyNonce(address,uint256,uint256,uint256,bytes32) view returns(bytes32)']),'buyNonce',[c.roles.buyer,2500000n,0n,deadline,salt]))throw Error('SDK buy nonce mismatch');
 const auth=await c.auth('buyer',series.curve,2500000n,nonce,'ReceiveWithAuthorization');
 await c.write(n,'gasless buy EIP-3009','relayer',series.curve,ba,'buyWithAuthorization',[c.roles.buyer,2500000n,0n,deadline,salt,auth.validAfter,auth.validBefore,auth.v,auth.r,auth.s]);
 const coins=await c.bal(c.roles.buyer); // USDC balance is independent of the coin permit.
 const amount=await c.read(series.coin,c.erc,'balanceOf',[c.roles.buyer]);
 const p=await c.permit('buyer',series.curve,amount,series.coin);
 const sig=await c.accounts.buyer.signTypedData({domain:{name:'KOMA Curve',version:'1',chainId:5042,verifyingContract:series.curve},types:sellTypes,primaryType:'Sell',message:{seller:c.roles.buyer,coinIn:amount,minUsdcOut:0n,deadline:p.deadline,nonce:await c.read(series.curve,ba,'sellNonces',[c.roles.buyer])}});
 await c.write(n,'gasless sell permit + signed intent','relayer',series.curve,ba,'sellWithPermit',[c.roles.buyer,amount,0n,p.deadline,p.v,p.r,p.s,sig]);
 if(await c.bal(c.roles.buyer)<=coins)throw Error('Sell did not pay buyer');
 c.note('series',{seriesId,...series,scope:'Factory and template are deployed mainnet contracts; this new user-created series exists only on the fork.'});
});
