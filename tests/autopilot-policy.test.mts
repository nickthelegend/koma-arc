// node --test tests/   (Node strips the TypeScript types; no build step)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, privyPolicy, type AutopilotPolicy } from "../src/lib/server/autopilot/policy.ts";

const P: AutopilotPolicy = {
  chainId: 10143,
  canonRegistry: "0x1111111111111111111111111111111111111111",
  ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  curve: "0x2222222222222222222222222222222222222222",
  vote: true,
  maxBuy: BigInt(3_000_000),
};
const vote = { domain: { chainId: 10143, verifyingContract: P.canonRegistry }, primaryType: "Vote", message: {} };
const buy = (to: string, value: bigint) => ({
  domain: { chainId: 10143, verifyingContract: P.ausd },
  primaryType: "ReceiveWithAuthorization",
  message: { to, value: value.toString() },
});

test("allows votes on the canon registry and capped buys into the series' curve", () => {
  assert.deepEqual(evaluate(P, vote), { ok: true, rule: "vote" });
  assert.deepEqual(evaluate(P, buy(P.curve, BigInt(3_000_000))), { ok: true, rule: "buy" });
});

test("refuses AUSD to anyone but the curve, over the cap, other contracts, other chains", () => {
  assert.equal(evaluate(P, buy("0x3333333333333333333333333333333333333333", BigInt(1))).ok, false);
  assert.equal(evaluate(P, buy(P.curve, BigInt(3_000_001))).ok, false);
  assert.equal(evaluate(P, { ...vote, domain: { chainId: 10143, verifyingContract: "0x4444444444444444444444444444444444444444" } }).ok, false);
  assert.equal(evaluate(P, { ...vote, domain: { ...vote.domain, chainId: 143 } }).ok, false);
  assert.equal(evaluate(P, { ...buy(P.curve, BigInt(1)), primaryType: "TransferWithAuthorization" }).ok, false);
});

test("switched-off rules refuse", () => {
  assert.equal(evaluate({ ...P, vote: false }, vote).ok, false);
  assert.equal(evaluate({ ...P, maxBuy: BigInt(0) }, buy(P.curve, BigInt(1))).ok, false);
});

test("the Privy policy mirrors the rules: default-deny, two ALLOW rules on eth_signTypedData_v4", () => {
  const pol = privyPolicy(P, "t");
  assert.equal(pol.version, "1.0");
  assert.equal(pol.chain_type, "ethereum");
  assert.equal(pol.rules.length, 2);
  for (const r of pol.rules) assert.equal(r.method, "eth_signTypedData_v4");
  const buyRule = pol.rules[1];
  assert.ok(buyRule.conditions.some((c) => c.field === "value" && c.operator === "lte" && c.value === "3000000"));
  assert.ok(buyRule.conditions.some((c) => c.field === "to" && c.value === P.curve));
  assert.equal(privyPolicy({ ...P, vote: false, maxBuy: BigInt(0) }, "t").rules.length, 0);
});
