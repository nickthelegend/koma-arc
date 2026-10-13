export type CctpFeeRow = { finalityThreshold: number; minimumFee: number; forwardFee?: { med: number } };

/** Iris expresses the rate in basis points and the forwarding fee in USDC base units. */
export function cctpFeeQuote(rows: CctpFeeRow[], amount: bigint, finality: number) {
  if (amount <= BigInt(0)) throw new Error("Enter a USDC amount above zero.");
  const row = rows.find(r => r.finalityThreshold === finality);
  if (!row?.forwardFee) throw new Error("Circle doesn't forward at that finality to that chain right now.");
  const { minimumFee, forwardFee: { med } } = row;
  if (!Number.isFinite(minimumFee) || minimumFee < 0 || !Number.isSafeInteger(med) || med < 0) {
    throw new Error("Circle returned an invalid fee quote.");
  }
  const rate = Math.ceil(minimumFee * 100);
  if (!Number.isSafeInteger(rate)) throw new Error("Circle returned an invalid fee rate.");
  const forwardFee = BigInt(med);
  const protocolFee = (amount * BigInt(rate) + BigInt(999_999)) / BigInt(1_000_000);
  // Round up both the rate charge and the 10% buffer, including a one-unit fee.
  const maxFee = ((forwardFee + protocolFee) * BigInt(110) + BigInt(99)) / BigInt(100);
  return { forwardFee, protocolFeeBps: minimumFee, maxFee };
}
