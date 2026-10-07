import { test } from "node:test";
import assert from "node:assert/strict";
import { soften } from "../src/lib/server/soften.ts";

// The prompt softener used after fal's content filter refuses a panel (src/lib/server/ai.ts retry → soften).
test("soften swaps the words fal's filter trips on and keeps the rest of the shot", () => {
  const out = soften("A mobster raises his gun in the rain, blood on the pavement, about to kill the courier");
  assert.equal(/gun|blood|kill|mobster/i.test(out), false);
  assert.match(out, /^non-graphic, all-ages comic illustration: /);
  assert.match(out, /raises his prop in the rain/);
  assert.match(out, /courier$/);
});

test("soften leaves harmless words alone", () => {
  assert.equal(soften("a gunmetal sky over the docks"), "non-graphic, all-ages comic illustration: a gunmetal sky over the docks");
});
