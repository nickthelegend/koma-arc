import { NextResponse } from 'next/server';
import { getAddress, isAddress, isHex, parseUnits, recoverTypedDataAddress, hashTypedData, type Hex } from 'viem';
import { gatewayAttestation, readGatewayAttestation, GatewayRecoveryRequired } from '@/lib/server/gateway-journal';
import {gatewayRecoveryProof,recoveryIssuedAt} from '@/lib/gateway-recovery-proof';
import { randomBytes } from 'node:crypto';
import { KOMA } from '@/lib/network';
import { buildBurnIntent, burnIntentFromJson, burnIntentToJson, burnIntentTypedData, burnIntentDepositor, burnIntentRecipient, gatewayFor, gatewayTransferSpecHash } from '@/lib/gateway';

export const dynamic = 'force-dynamic';
const enabled = () => process.env.NEXT_PUBLIC_FEATURE_GATEWAY === '1';
class GatewayUpstreamError extends Error {}
const gateway = () => gatewayFor(KOMA.testnet ? 'testnet' : 'mainnet');
async function circle(path: string, body?: unknown) {
  let response;
  try { response = await fetch(`${gateway().apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), cache: 'no-store',
  }); } catch { throw new GatewayUpstreamError('Circle Gateway is unavailable. Try again later.'); }
  let data;
  try { data = await response.json(); } catch { throw new GatewayUpstreamError('Circle Gateway returned an unreadable response.'); }
  if (!response.ok) throw new GatewayUpstreamError(typeof data?.message === 'string' ? data.message : `Circle Gateway returned ${response.status}.`);
  return data;
}

/** Read-only unified balance; no wallet keys or relayer involved. */
export async function GET(request: Request) {
  if (!enabled()) return NextResponse.json({ error: 'Gateway funding is unavailable.' }, { status: 503 });
  const address = new URL(request.url).searchParams.get('address');
  if (!address || !isAddress(address)) return NextResponse.json({ error: 'Enter a valid wallet address.' }, { status: 400 });
  try {
    const g = gateway();
    const data = await circle('/v1/balances', { token: 'USDC', sources: g.sources.map(s => ({ domain: s.domain, depositor: getAddress(address) })) });
    return NextResponse.json({ gateway: g, balances: data.balances ?? [] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Gateway is unavailable.' }, { status: 502 }); }
}

/** Quotes are unsigned; attestations require the depositor's exact signature. Minting stays in their wallet. */
export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: 'Gateway funding is unavailable.' }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  try {
    if (!body || typeof body !== 'object') throw new Error('Invalid funding request.');
    const g = gateway();
    if (body.action === 'quote') {
      if (!isAddress(body.address ?? '') || typeof body.amount !== 'string' || !/^\d+(\.\d{1,6})?$/.test(body.amount)) throw new Error('Enter a wallet address and a positive USDC amount with at most six decimals.');
      const intent = buildBurnIntent(g, { depositor: getAddress(body.address), recipient: getAddress(body.address), sourceDomain: Number(body.sourceDomain), value: parseUnits(body.amount, 6), salt: `0x${randomBytes(32).toString('hex')}` });
      const input = burnIntentToJson(intent);
      // Circle supplies the live fee and expiry; never rely on the codec's historical fee estimate.
      const estimated = await circle('/v1/estimate', [{ spec: input.spec }]);
      const quote = estimated.body?.[0]?.burnIntent;
      if (!quote?.maxFee || !quote?.maxBlockHeight) throw new Error('Circle did not return a usable fee and expiry.');
      const exact = burnIntentFromJson(g, { ...input, maxFee: quote.maxFee, maxBlockHeight: quote.maxBlockHeight });
      return NextResponse.json({ burnIntent: burnIntentToJson(exact), gateway: g });
    }
    if (body.action === 'attest' || body.action === 'recover') {
      const intent = burnIntentFromJson(g, body.burnIntent);
      const depositor = burnIntentDepositor(intent);
      if (burnIntentRecipient(intent) !== depositor) throw new Error('Gateway funding must return to the depositing wallet.');
      const key = hashTypedData(burnIntentTypedData(intent));
      if(body.action==='recover'){
        if(KOMA.chain.id!==5042002)throw new Error('Read recovery requires Arc testnet.');
        let reader;
        if(typeof body.signature==='string'&&isHex(body.signature)){
          // Existing private original-signature recovery remains read-only.
          reader=await recoverTypedDataAddress({...burnIntentTypedData(intent),signature:body.signature as Hex});
        }else{
          if(typeof body.recoverySignature!=='string'||!isHex(body.recoverySignature))throw new Error('Sign the read-only recovery proof with the original depositing wallet.');
          const issuedAt=recoveryIssuedAt(body.issuedAt,Math.floor(Date.now()/1000));
          reader=await recoverTypedDataAddress({...gatewayRecoveryProof(g,intent,issuedAt),signature:body.recoverySignature as Hex});
        }
        if(getAddress(reader)!==depositor)throw new Error('The original depositor did not authorize this read-only recovery.');
      }
      if (body.action === 'recover' && body.transferId) {
        if (typeof body.transferId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.transferId)) throw new Error('Invalid Circle transfer ID.');
        const data = await circle(`/v1/transfer/${body.transferId}`);
        const specHash = gatewayTransferSpecHash(intent);
        if (data.destinationDomain !== g.arcDomain || !data.burnIntents?.some((i: { transferSpecHash?: string }) => i.transferSpecHash?.toLowerCase() === specHash)) throw new Error('This Circle transfer does not match your signed funding intent.');
        if (data.status === 'expired') throw new GatewayRecoveryRequired('Circle reports this attestation expired. Contact Circle with the original transfer ID.');
        if (!isHex(data.attestation?.payload) || !isHex(data.attestation?.signature)) throw new GatewayRecoveryRequired('Circle has not returned a mintable attestation yet.');
        const result = { attestation: data.attestation.payload, signature: data.attestation.signature, minter: g.minter, transferId: body.transferId, expirationBlock: data.attestation.expirationBlock };
        return NextResponse.json({ ...result, status: data.status, transactionHash: data.transactionHash });
      }
      if(body.action==='recover')return NextResponse.json(readGatewayAttestation(key));
      if (typeof body.signature !== 'string' || !isHex(body.signature)) throw new Error('The wallet signature is missing.');
      const recovered = await recoverTypedDataAddress({ ...burnIntentTypedData(intent), signature: body.signature as Hex });
      if (getAddress(recovered) !== depositor) throw new Error('The depositor did not sign this funding request.');
      const result = await gatewayAttestation(key, async () => {
        const data = await circle('/v1/transfer', [{ burnIntent: burnIntentToJson(intent), signature: body.signature }]);
        if (!isHex(data.attestation) || !isHex(data.signature)) throw new Error('Circle did not return a valid attestation.');
        return { attestation: data.attestation, signature: data.signature, minter: g.minter, transferId: data.transferId, expirationBlock: data.expirationBlock };
      }, body.action === 'recover');
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'Unknown funding action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Gateway funding failed.' }, { status: error instanceof GatewayRecoveryRequired ? 409 : error instanceof GatewayUpstreamError ? 502 : 400 }); }
}
