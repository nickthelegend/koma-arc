# Sponsor integrations: what's built, what's verified, what's left

Status on **6 Oct 2026**. "Verified" means run for real on the local stack: an anvil fork of Monad testnet with
real AUSD, Tokenbound and Permit2, and Uniswap v4 deployed by the deploy script. The AI runs on real models; the
running product has no mocks, fixtures or placeholder data. Anything that needs Monad testnet itself is
**awaiting the owner's go** (no MON spent yet, by instruction). The exact steps are in `docs/DEPLOY-LATER.md`.

| Sponsor / bounty | Built | Verified (command) | Left, and what it needs |
|---|---|---|---|
| **Track 3: Social, Attention & Culture** | Fans co-own a character's story: a series coin on an AUSD curve, holders vote canon, the character earns from every trade | `test:launchpad` 18/18, `test:browser` 8/8, `test:walk` 16/16 | Testnet deploy + hosting (go) |
| **Tencent Hunyuan** (T3) | Hunyuan 3 (`hy3`) is the **studio's editor**: an interactive chat that shapes your idea into a priced, valid pitch. **Hunyuan Image 3** draws every **character sheet** (and issue covers) | `test:ai` A1–A3, `test:browser` W2/W3/W6 (real issue credited "Art by Hunyuan Image 3"), a real launch's 852 KB Hunyuan sheet | The direct TokenHub route (`HUNYUAN_API_KEY`) is the same OpenAI-compatible code but untested without a key; today Hunyuan 3 runs through fal's OpenRouter endpoint |
| **Kimi** | Kimi K2.6 **writes every comic script**. For a series episode it runs a **tool loop**: it calls `get_series_canon` to read the episodes holders voted into canon, then writes the next one to continue them | `test:ai` A3/A4 (credits on real issues: writer `moonshotai/kimi-k2.6`, tool calls `get_series_canon`) | Direct Moonshot route (`MOONSHOT_API_KEY`) untested without a key; today Kimi runs through fal's OpenRouter endpoint |
| **Privy** (beyond login) | Embedded wallets (email / Google / passkey) as the account layer; **gas sponsorship** (`sponsor: true`) for the wallet's own transactions; a **session signer + policy** (backer autopilot: KOMA votes and buys for you, default-deny policy pinned to this series' canon votes and AUSD to this curve, capped per buy) | Policy unit tests (`test:unit`), the Privy build compiles, `test:autopilot` P0 (honestly off without keys) | **Untested live: needs** `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PRIVY_SIGNER_ID`, and gas sponsorship on for Monad Testnet in the dashboard. Then `test:autopilot` P1–P6 |
| **Envio** | HyperIndex V3 indexer (`indexer/`): series aggregates and fee split, trades across curve and v4 pool, holders, a **backer leaderboard**, daily volume, canon rounds (incl. which were settled by CRE), comics, global stats; dynamic contract registration. Feeds the **/series leaderboard** via `/api/board` | `test:envio` 7/7: synced to head, parity with the chain and the app's own index on every series, a live trade indexed in < 5 s, the board served from Envio | Envio Cloud hosting + HyperSync on testnet (`ENVIO_API_TOKEN`, after the deploy) |
| **Chainlink CRE** | `cre/koma-canon`: a TS workflow that **settles canon votes**. Each run reads closed slots and signed votes over HTTP (identical-bytes consensus), re-checks everything on Monad (slot, proposals, every EIP-712 signature, each voter's weight at the snapshot), applies KOMA's tie rules and writes one report to `CanonSettler` (on Chainlink's `ReceiverTemplate`), which finalizes the slots. The app's keeper becomes a fallback | `bun test` 8/8 (SDK test runtime), compiles to WASM, `forge test` CanonSettler 9/9, `test:cre` 7/7 on the fork (report delivered through Monad testnet's MockKeystoneForwarder; the on-chain votes root equals the keeper's; the canon board shows "Settled by Chainlink CRE") | **`cre workflow simulate` needs `cre login`** (owner, browser). A broadcast on testnet needs the deploy |
| **Mera: One Passkey, Many Keys** | `/room`, the **Writers' Room**: one WebAuthn PRF evaluation under KOMA's own salt → HKDF → an Ed25519 room identity (Mera signing session; signs every request) and an AES-256-GCM drafts key. Unpublished pitches and twists are end-to-end encrypted; the server stores ciphertext under a room id that isn't linked to any wallet | `test:room` 7/7 (headless Chromium, virtual authenticator with PRF): ciphertext only in the database, forged requests 401, **wipe storage → same room rebuilt and decrypted**, another passkey → another room, the pitch goes to the studio in-tab | **Cross-device test on two real devices** with one synced passkey (Chrome's virtual authenticator doesn't export the PRF seed) |
| Agora AUSD | The currency everywhere: x402 payments, curves, pools, fees; the in-app faucet calls Agora's faucet contract | every on-chain suite | Agora's bounties are T1/T2 and mobile, so not claimed |

## Not claimed

- **Mera UX:** Privy is KOMA's account layer; Mera does non-wallet work only (the Writers' Room).
- **Dynamic:** Privy covers the account layer.
- **Kuru, Perpl, MetaMask Agent Wallet, Agora:** T1/T2 trading and payments.
- **Alchemy, Nansen:** no meaningful use.

## Known gaps (honest list)

1. **Monad testnet deploy and hosting:** not done by instruction (awaiting go and ~15 MON). Runbook ready.
2. **Privy live path:** code complete, untested without the app credentials (above).
3. **`cre workflow simulate`:** needs `cre login`. The same rules ran through the forwarder on the fork.
4. **Direct Moonshot / TokenHub routes:** untested without those keys. The same models are verified through fal.
5. **Mera cross-device:** needs two real devices.
6. **Hunyuan cover economics:** a Hunyuan Image 3 cover costs $0.10, so a 1-page issue sold at $0.10 costs ~$0.15
   to make. `HUNYUAN_COVERS=0` switches covers to FLUX.2 (~$0.06 per issue); sheets stay on Hunyuan.
