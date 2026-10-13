import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayFor, buildBurnIntent, burnIntentToJson, burnIntentFromJson } from '../src/lib/gateway.ts';
const g = gatewayFor('testnet');
const owner = '0x1111111111111111111111111111111111111111';
const input = () => burnIntentToJson(buildBurnIntent(g, { depositor: owner, recipient: owner, sourceDomain: 0, value: 1000000n, salt: `0x${'a'.repeat(64)}` }));
test('Gateway quotes preserve intended Arc network, recipient and amount', () => {
  const json = input();
  assert.deepEqual(burnIntentToJson(burnIntentFromJson(g, json)), json);
  assert.equal(json.spec.destinationDomain, 26);
  assert.throws(() => burnIntentFromJson(gatewayFor('mainnet'), json));
});
test('Gateway rejects tampered token, destination, caller, signer and address padding', () => {
  for (const field of ['sourceToken', 'destinationToken', 'destinationContract', 'sourceSigner', 'destinationCaller', 'sourceDepositor', 'destinationRecipient']) {
    const json = input();
    json.spec[field] = `0x${'f'.repeat(64)}`;
    assert.throws(() => burnIntentFromJson(g, json), field);
  }
  const hooked = input(); hooked.spec.hookData = '0xff';
  assert.throws(() => burnIntentFromJson(g, hooked));
});
test('Gateway enforces positive bounded amounts and a capped live quote fee', () => {
  for (const value of [0n, -1n, 1000000001n]) assert.throws(() => buildBurnIntent(g, { depositor: owner, recipient: owner, sourceDomain: 0, value, salt: `0x${'a'.repeat(64)}` }));
  for (const maxFee of ['-1', '10000001']) assert.throws(() => burnIntentFromJson(g, { ...input(), maxFee }));
  for (const maxBlockHeight of ['0', '-1']) assert.throws(() => burnIntentFromJson(g, { ...input(), maxBlockHeight }));
  assert.equal(burnIntentFromJson(g, { ...input(), maxFee: '125000' }).maxFee, 125000n);
});
