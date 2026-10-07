import type { Metadata } from "next";
import { WritersRoom } from "@/components/room/writers-room";

export const metadata: Metadata = {
  title: "Writers' Room",
  description: "Unpublished pitches and story notes, end-to-end encrypted to your passkey. KOMA stores ciphertext it can't read.",
};

export default function RoomPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <h1 className="masthead text-[18vw] text-kapow sm:text-[clamp(72px,8vw,112px)]">Writers&rsquo; Room</h1>
        <p className="max-w-[440px] text-[14px] leading-relaxed text-soft md:pb-2">
          Where next week&rsquo;s twist waits before it&rsquo;s a proposal. Drafts are encrypted in your browser with a key only your passkey can
          make, so KOMA stores ciphertext it can&rsquo;t read, and nobody can front-run your canon pitch.
        </p>
      </div>
      <div className="mt-8">
        <WritersRoom />
      </div>
      <details className="mt-8 max-w-[760px] text-[13px] leading-relaxed text-soft">
        <summary className="cursor-pointer font-display text-[15px] uppercase text-paper">How the room works</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>
            Your passkey evaluates WebAuthn PRF under KOMA&rsquo;s own salt (<code className="font-mono text-[12px]">koma.writers-room.v1</code>), using
            Mera. That gives 32 secret bytes on your device, and the same bytes on any device with the same passkey.
          </li>
          <li>
            HKDF splits them into two keys that are not a wallet: an Ed25519 identity (its public key is your room id; it signs each request) and an
            AES-256-GCM key that encrypts each draft, bound to its room and draft id.
          </li>
          <li>Nothing secret is stored: the keys live in memory, are zeroed when the room locks (10 minutes, or when you leave), and never sign a transaction.</li>
          <li>The room id isn&rsquo;t derived from, or linked to, your KOMA wallet. Clear this browser or switch devices, open with the passkey, and the room is back.</li>
        </ul>
      </details>
    </div>
  );
}
