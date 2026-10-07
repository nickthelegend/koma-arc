import type { Addr } from "@/lib/launchpad/types";

/**
 * What a backer lets KOMA sign for them, per series. This becomes a Privy policy attached to the
 * session signer on the backer's embedded wallet, so Privy refuses anything outside it even if
 * KOMA's server were compromised. The same rules are evaluated here before every signature.
 */
export type AutopilotPolicy = {
  chainId: number;
  canonRegistry: Addr;
  ausd: Addr;
  curve: Addr;
  /** Sign canon votes for this series (EIP-712 "KOMA Canon" on the canon registry). */
  vote: boolean;
  /** Largest single AUSD buy authorization KOMA may sign, in base units (0 = never buy). */
  maxBuy: bigint;
};

export type TypedPayload = {
  domain: { name?: string; version?: string; chainId?: number | bigint; verifyingContract?: string };
  primaryType: string;
  message: Record<string, unknown>;
};

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The rule this payload falls under, or why it is refused. Mirrors `privyPolicy` exactly. */
export function evaluate(p: AutopilotPolicy, t: TypedPayload): { ok: true; rule: "vote" | "buy" } | { ok: false; reason: string } {
  if (Number(t.domain.chainId) !== p.chainId) return { ok: false, reason: "wrong chain" };
  if (same(t.domain.verifyingContract, p.canonRegistry)) {
    if (!p.vote) return { ok: false, reason: "voting is off for this series" };
    if (t.primaryType !== "Vote") return { ok: false, reason: "only Vote messages on the canon registry" };
    return { ok: true, rule: "vote" };
  }
  if (same(t.domain.verifyingContract, p.ausd)) {
    if (p.maxBuy === BigInt(0)) return { ok: false, reason: "auto-buy is off for this series" };
    if (t.primaryType !== "ReceiveWithAuthorization") return { ok: false, reason: "only buy authorizations on AUSD" };
    if (!same(String(t.message.to), p.curve)) return { ok: false, reason: "AUSD can only go to this series' curve" };
    if (BigInt(String(t.message.value)) > p.maxBuy) return { ok: false, reason: "over the per-buy cap" };
    return { ok: true, rule: "buy" };
  }
  return { ok: false, reason: "contract not allowed" };
}

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/** The Privy policy (policy engine v1.0): default-deny, two ALLOW rules on eth_signTypedData_v4. */
export function privyPolicy(p: AutopilotPolicy, name: string) {
  const rules = [];
  if (p.vote) {
    rules.push({
      name: "Sign canon votes for this series",
      method: "eth_signTypedData_v4" as const,
      action: "ALLOW" as const,
      conditions: [
        { field_source: "ethereum_typed_data_domain" as const, field: "verifyingContract" as const, operator: "eq" as const, value: p.canonRegistry },
        { field_source: "ethereum_typed_data_domain" as const, field: "chainId" as const, operator: "eq" as const, value: String(p.chainId) },
      ],
    });
  }
  if (p.maxBuy > BigInt(0)) {
    const typed_data = { types: RECEIVE_TYPES, primary_type: "ReceiveWithAuthorization" };
    rules.push({
      name: "Buy this series' coin, capped per buy",
      method: "eth_signTypedData_v4" as const,
      action: "ALLOW" as const,
      conditions: [
        { field_source: "ethereum_typed_data_domain" as const, field: "verifyingContract" as const, operator: "eq" as const, value: p.ausd },
        { field_source: "ethereum_typed_data_domain" as const, field: "chainId" as const, operator: "eq" as const, value: String(p.chainId) },
        { field_source: "ethereum_typed_data_message" as const, field: "to", operator: "eq" as const, value: p.curve, typed_data },
        { field_source: "ethereum_typed_data_message" as const, field: "value", operator: "lte" as const, value: p.maxBuy.toString(), typed_data },
      ],
    });
  }
  return { version: "1.0" as const, name, chain_type: "ethereum" as const, rules };
}
