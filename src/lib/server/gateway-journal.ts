import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Hex } from 'viem';
export type GatewayResult = { attestation: Hex; signature: Hex; minter: Hex; transferId?: string; expirationBlock?: string };
type Entry = { state: 'unknown' | 'accepted'; result?: GatewayResult };
const inFlight = new Map<string, Promise<GatewayResult>>();
export class GatewayRecoveryRequired extends Error {}
function pathFor(key: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(key)) throw new Error('Invalid Gateway request identity.');
  return join(process.env.KOMA_DATA_DIR || join(process.cwd(), '.data'), 'gateway', `${key}.json`);
}
function read(file: string): Entry | null {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
function save(file: string, entry: Entry) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(entry), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
/** Persist uncertainty before submitting; never create a second transfer on a recovery retry. */
export async function gatewayAttestation(key: string, submit: () => Promise<GatewayResult>, recover = false): Promise<GatewayResult> {
  const file = pathFor(key);
  const active = inFlight.get(file);
  if (active) return active;
  const entry = read(file);
  if (entry?.state === 'accepted' && entry.result) return entry.result;
  if (entry || recover) throw new GatewayRecoveryRequired('Transfer outcome is not known yet. Resume later, or supply the original Circle transfer ID. Do not authorize another transfer.');
  save(file, { state: 'unknown' });
  const task = (async () => { const result = await submit(); save(file, { state: 'accepted', result }); return result; })();
  inFlight.set(file, task);
  try { return await task; } finally { inFlight.delete(file); }
}
/** Called only after Circle lookup binds a transfer ID to the original TransferSpec hash. */
export function saveRecoveredGateway(key: string, result: GatewayResult) { save(pathFor(key), { state: 'accepted', result }); }

/** Read-only recovery; never provisions or retries a Circle transfer. */
export function readGatewayAttestation(key:string):GatewayResult {
 const entry=read(pathFor(key));if(entry?.state==='accepted'&&entry.result)return entry.result;
 throw new GatewayRecoveryRequired('Original transfer is unresolved. Supply its genuine Circle transfer ID or contact Circle; no transfer was resubmitted.');
}
