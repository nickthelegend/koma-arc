import { GatewayFunding } from '@/components/gateway-funding';
export default function Fund() {
  return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="masthead text-5xl text-paper">Fund your wallet</h1>{process.env.NEXT_PUBLIC_FEATURE_GATEWAY === '1' ? <GatewayFunding /> : <p className="mt-6 text-soft">Gateway funding is unavailable. You can transfer USDC to your Arc wallet using your existing wallet.</p>}</main>;
}
