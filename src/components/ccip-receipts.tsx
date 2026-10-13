import { canonReceiptView } from '@/lib/server/ccip-receipts';
export async function CcipReceipts() {
 const view=await canonReceiptView();
 return <section className="mt-12 border-t border-rule pt-6 pb-12" aria-labelledby="ccip-receipts">
  <h2 id="ccip-receipts" className="font-display text-3xl text-paper">Cross-chain canon receipts</h2>
  <p className="mt-3 max-w-2xl text-sm text-soft">These messages record finalized canon from an allowed source. They do not transfer USDC, mint issues or change local votes.</p>
  {view.state==='unconfigured' && <p className="mt-4 text-mute">Cross-chain receipts are not configured yet.</p>}
  {view.state==='unavailable' && <p className="mt-4 text-mute" role="status">Cross-chain receipts could not be read. Try again later.</p>}
  {view.state==='ready' && <>
   <p className="mt-4 break-all font-mono text-xs text-mute">Receiver {view.receiver} · chain {view.chainId}<br/>Router {view.router}<br/>Most recent 1,000 blocks ({view.fromBlock}–{view.toBlock}); up to 25 receipts. This is a recent scan, not a full history.</p>
   {view.rows.length===0 && <p className="mt-4 text-mute">No canon receipts found in this block range.</p>}
   <ul className="mt-4 divide-y divide-rule">{view.rows.map(row=><li key={row.messageId} className="space-y-2 py-4 text-sm text-soft">
    <p className="font-display text-xl text-paper">Series {row.seriesId} · episode {row.episode} · issue {row.issueId}</p>
    <p>Source selector {row.sourceChain} · block {row.block}</p>
    <dl className="space-y-1 break-all font-mono text-xs"><div><dt className="inline">Sender: </dt><dd className="inline">{row.sender}</dd></div><div><dt className="inline">Content hash: </dt><dd className="inline">{row.contentHash}</dd></div><div><dt className="inline">Source payment: </dt><dd className="inline">{row.paymentTx}</dd></div><div><dt className="inline">CCIP message: </dt><dd className="inline">{row.messageId}</dd></div><div><dt className="inline">Destination transaction: </dt><dd className="inline">{row.transactionHash}</dd></div></dl>
    <p className="text-xs text-arb">Confirmed in receiver storage at read time.</p>
   </li>)}</ul>
  </>}
 </section>;
}
