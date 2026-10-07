import { PrivyClient } from "@privy-io/node";
import type { Addr } from "@/lib/launchpad/types";
import { evaluate, privyPolicy, type AutopilotPolicy, type TypedPayload } from "./policy";

/**
 * Who signs for a backer while they're away.
 *
 *   privy    — a Privy session signer on the backer's embedded wallet. KOMA holds an authorization key
 *              (PRIVY_AUTHORIZATION_KEY) for a key quorum (PRIVY_SIGNER_ID) the backer added with a policy;
 *              Privy signs inside its enclave only if the policy allows it.
 *   off      — Privy isn't configured; the autopilot panel says so and nothing is signed for anyone.
 */
export type SignerMode = "privy" | "off";

const env = (k: string) => (process.env[k] ?? "").trim();

export function signerMode(): SignerMode {
  if (env("PRIVY_APP_ID") && env("PRIVY_APP_SECRET") && env("PRIVY_AUTHORIZATION_KEY") && env("PRIVY_SIGNER_ID")) return "privy";
  return "off";
}

let client: PrivyClient | null = null;
function privy() {
  client ??= new PrivyClient({ appId: env("PRIVY_APP_ID"), appSecret: env("PRIVY_APP_SECRET") });
  return client;
}

/** The signer id the backer's wallet must add (with the policy) so KOMA can sign. */
export const signerId = () => env("PRIVY_SIGNER_ID");

/** Creates the policy for an enrollment in Privy's policy engine. */
export async function createPolicy(p: AutopilotPolicy, name: string): Promise<string> {
  if (signerMode() !== "privy") throw new Error("autopilot signer isn't configured");
  const created = await privy().policies().create(privyPolicy(p, name) as never);
  return (created as { id: string }).id;
}

/** Checks a claimed Privy wallet id really is this address's embedded wallet. */
export async function walletMatches(walletId: string, address: Addr): Promise<boolean> {
  if (signerMode() !== "privy") return false;
  const w = (await privy().wallets().get(walletId)) as { address?: string };
  return w.address?.toLowerCase() === address.toLowerCase();
}

const json = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(json) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, json(x)])) : v;

/**
 * Signs one EIP-712 payload for a backer. The local policy check always runs first; in Privy mode the
 * policy attached to the session signer is enforced again by Privy.
 */
export async function signFor(
  who: { address: Addr; walletId: string | null; policy: AutopilotPolicy },
  t: TypedPayload & { types: Record<string, { name: string; type: string }[]> },
): Promise<`0x${string}`> {
  const verdict = evaluate(who.policy, t);
  if (!verdict.ok) throw new Error(`autopilot policy refused: ${verdict.reason}`);
  const mode = signerMode();
  if (mode === "privy") {
    if (!who.walletId) throw new Error("no Privy wallet id on this enrollment");
    const r = await privy()
      .wallets()
      .ethereum()
      .signTypedData(who.walletId, {
        params: { typed_data: { domain: json(t.domain) as never, types: t.types as never, primary_type: t.primaryType, message: json(t.message) as never } },
        authorization_context: { authorization_private_keys: [env("PRIVY_AUTHORIZATION_KEY")] },
      } as never);
    return (r as { signature: `0x${string}` }).signature;
  }
  throw new Error("autopilot signer isn't configured");
}
