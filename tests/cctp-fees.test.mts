import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cctpFeeQuote } from '../src/lib/launchpad/cctp-fees.ts';
const fee = (minimumFee = 1, med = 10) => [{ finalityThreshold: 2000, minimumFee, forwardFee: { med } }];
test('one USDC at one basis point includes forwarding and rounded-up headroom', () => {
  assert.deepEqual(cctpFeeQuote(fee(), 1_000_000n, 2000), { forwardFee: 10n, protocolFeeBps: 1, maxFee: 121n });
});
test('fractional base-unit fee and headroom always round up', () => {
  assert.equal(cctpFeeQuote(fee(0.001, 0), 1n, 2000).maxFee, 2n);
});
test('never substitutes another finality or accepts invalid quote numbers', () => {
  assert.throws(() => cctpFeeQuote(fee(), 1n, 1000), /finality/);
  for (const rows of [fee(NaN), fee(-1), fee(1, -1), fee(1, 0.5), fee(1, Infinity)]) {
    assert.throws(() => cctpFeeQuote(rows, 1n, 2000), /invalid/);
  }
  assert.throws(() => cctpFeeQuote(fee(), 0n, 2000), /above zero/);
});
