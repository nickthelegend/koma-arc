# KOMA — Monad Metropolis submission

| | |
|---|---|
| **Project** | KOMA: comics fans own, and characters whose stories their holders write |
| **Track** | **03 · Social, Attention & Culture** |
| **Network** | Monad testnet (10143). *Not deployed yet; awaiting the owner's go ([runbook](docs/DEPLOY-LATER.md)). Today everything runs on an anvil fork of Monad testnet with `npm run demo`: real contracts, Agora's real AUSD, real AI models, no mocks.* |
| **Live app** | `TODO after deploy` |
| **Repo** | `TODO: github.com/<owner>/koma-monad` (MIT) |
| **Demo video (≤ 3 min)** | `TODO` (script below) |
| **Judge login** | None needed: connect any wallet (or Privy email once keys are set) and tap **Get 10,000 test AUSD** |

## One paragraph

KOMA turns fandom into ownership. Describe a story: an AI editor (Tencent Hunyuan 3) shapes it into a pitch, Kimi
K2.6 writes it and fal draws it, and for a few cents of AUSD on Monad (one signature, no gas) the issue is minted to
you. Launch its hero as a series and the character becomes an economy: a Character NFT with its own wallet that
earns 40% of every trade, a coin on an AUSD curve, and a canon that holders write together. They propose episodes
(Kimi reads the voted canon before writing each one), vote for free, and a Chainlink CRE workflow settles the
winner on Monad. Envio powers the leaderboard, Privy lets backers put their votes and buys on autopilot under a
policy, and Mera passkeys keep next week's twist encrypted in the Writers' Room until it's pitched.

## Portal fields (copy-paste)

| Field | Value |
|---|---|
| Project name | KOMA |
| Tagline | AI comics you own, and characters whose canon their holders write, on Monad. |
| Track | 03 · Social, Attention & Culture |
| Bounties | Tencent Hunyuan · Kimi · Privy · Envio · Chainlink CRE · Mera (One Passkey, Many Keys) (+ Community Team if applicable) |
| Repo | `TODO` |
| Live URL | `TODO after deploy` |
| Contract addresses | `TODO after deploy`: `deploy/addresses.10143.json` |
| Demo video | `TODO` |
| Pre-existing work | KOMA's comic pipeline, x402 payments, launchpad contracts and UI were first built for Arbitrum (29 Sep – 4 Oct 2026, another hackathon). The Monad port and every sponsor integration were built 5–6 Oct 2026. See README → "Built in the Metropolis window". |
| AI tools | Claude Code wrote most of the code, tests and docs under the author's direction. At runtime: Kimi K2.6, Hunyuan 3, Hunyuan Image 3, FLUX.2. |

## Bounties targeted

Status: built and verified on the local fork. What each still needs is in [docs/SPONSOR-GAP.md](docs/SPONSOR-GAP.md).

| Bounty | How KOMA meets the stated requirement | Evidence |
|---|---|---|
| **Tencent Hunyuan** (T3: "a multimodal or interactive experience genuinely powered by Hunyuan") | **Interactive:** Hunyuan 3 is the studio's editor. You talk your idea through and it answers with a priced, valid pitch you can pay for. **Multimodal:** Hunyuan Image 3 draws every series' character sheet, and that sheet keeps the hero on model in every episode; it also draws issue covers. Both are in the core path; nothing is drawn or pitched without them. | `test:ai` A1–A3; `test:browser` W2 (real Hunyuan pitch → paid → minted), W3 (the issue page credits "Art by Hunyuan Image 3"), W6 (a real launch's Hunyuan sheet) |
| **Kimi** ("genuinely powered by Kimi") | Kimi K2.6 writes every comic. For a series episode it runs an agentic tool loop: it calls `get_series_canon` to read what holders voted into canon, then writes the episode to continue it. Every issue records the model and tool calls, and its page shows them. | `test:ai` A3/A4: credits on real issues (`moonshotai/kimi-k2.6`, tool calls `get_series_canon`) |
| **Privy** ("beyond authentication"; bonus for multiple features) | (1) **Embedded wallets** as the account layer (email, Google, passkey). (2) **Native gas sponsorship**: the embedded wallet's own transactions go out with `sponsor: true`. (3) **Session signer + policy engine**: the backer autopilot adds KOMA's key quorum to your wallet with a default-deny policy that allows only canon votes on that series and AUSD `ReceiveWithAuthorization` to that curve, capped per buy. KOMA's server then votes and buys for you while you're away, and Privy enforces the policy. | Policy unit tests; build compiles; `test:autopilot` P0. **Live run needs the Privy app credentials** |
| **Envio** (HyperIndex powering a core feature; derived/aggregated entities) | A HyperIndex V3 indexer over 9 contracts. It registers curves and coins dynamically and derives series aggregates (volume, buys and sells, fee split character / ancestors / treasury, holders, canon count), a backer leaderboard, daily volume and close, canon rounds (including which were settled by CRE), comics and global stats. The **/series leaderboard** reads it over GraphQL. | `test:envio` 7/7: synced to head; parity with chain and app on every series; a live trade indexed in < 5 s; the board served from Envio |
| **Chainlink CRE** ("a workflow used as an orchestration layer") | `koma-canon` is the settlement layer for canon. A cron trigger reads due slots and signed votes over HTTP (identical-bytes consensus). EVM reads on Monad check each slot, its proposals and the character owner. Every EIP-712 vote is recovered and its weight re-read at the snapshot. KOMA's tie rules then pick the winner, and `writeReport` sends it to `CanonSettler`, a `ReceiverTemplate` that holds the registry's relayer role and calls `finalize`. The server's keeper is only a fallback. | `bun test` 8/8; WASM compile; `forge test` CanonSettler 9/9; `test:cre` 7/7: real votes on the fork are settled through the MockKeystoneForwarder, the on-chain votes root equals the keeper's, and the UI shows "Settled by Chainlink CRE". **`cre workflow simulate` needs `cre login`** |
| **Mera: One Passkey, Many Keys** (non-wallet use of PRF; namespaced salts; nothing sensitive persisted; cross-device) | The **Writers' Room** (`/room`). A KOMA-specific PRF salt (`koma.writers-room.v1`, never the wallet salt) goes through HKDF into an Ed25519 identity (a Mera signing session; its public key is the room id and it signs every request) and an AES-256-GCM key that encrypts each draft, bound by AAD to its room and draft. The server holds only ciphertext under a room id unlinked to any wallet. Keys live in memory and are zeroed on lock (10 min) or when you leave. "Take the pitch to the studio" hands a draft over in-tab, never in a URL. | `test:room` 7/7 (virtual PRF authenticator): ciphertext-only DB, forged requests 401, wiped storage → the same room is rebuilt and decrypted, another passkey → another room. **Cross-device on two real devices pending** |

**Also integrated (no separate bounty):** Agora AUSD is the currency of every payment, curve, pool and fee
(EIP-3009, permit), and the faucet in the app calls Agora's faucet contract.

**Not claimed:** Mera UX (Privy is the account layer), Dynamic, Kuru, Perpl, MetaMask, Agora (T1/T2), Alchemy,
Nansen.

## Monad integration

- Every buy, sell, vote, payment and launch is a Monad transaction or an EIP-712 signature settled by one. KOMA
  relays them gaslessly, which pays only because Monad's gas is cheap and blocks are fast.
- Gas limits are sized from estimates (Monad bills the limit). Log scans respect the public RPC's 100-block cap.
- Uniswap v4 isn't on Monad testnet, so the deploy script deploys the canonical PoolManager, PositionManager and
  V4Quoter from Uniswap's artifacts, and graduation seeds a real v4 pool behind KOMA's hook.
- AUSD is native: payments, curves and pools are in dollars with no bridge.

## Evidence

Full run on 6 Oct 2026 on a **clean** local deployment (`npm run demo` from an empty `.data`), Monad testnet fork, real models. Live tx hashes get added after the deploy:

| Suite | Result |
|---|---|
| `forge test` (unit + fuzz) | 168 passed |
| `forge test` fork (live Monad testnet state) | 5 passed |
| `bun test` (CRE workflow) + WASM compile | 8 passed, compiled |
| `npm run test:unit` | 6 passed |
| `test:api` (x402 + issues, real models) | 13/13 |
| `test:launchpad` (launch → trade → canon → graduate) | 18/18 |
| `check-economics` (fees, royalties, pool on chain) | 9/9 |
| `test:ai` (real Kimi / Hunyuan, credits, episode tool call) | 4/4 |
| `test:cre` (CRE settlement) | 7/7 |
| `test:envio` (indexer) | 7/7 |
| `test:room` (Mera) | 7/7 (+1 skipped: cross-device) |
| `test:browser` (UI flows, real signatures) | 8/8 |
| `test:walk` (16 pages at 375 px) | 16/16 |
| `test:autopilot` | P0 pass (honestly off); P1–P6 untested (Privy keys) |
| lint, typecheck (`next build`), slither | clean; slither 8 low/medium findings triaged (see `docs/TEST-PLAN-ZERO-MOCK.md`) |
| secret scan (13 real secrets checked against the whole history and tree) | none found |

## Demo script (3:00)

| Time | Shot | Say |
|---|---|---|
| 0:00 | Home → `/series` board, leaderboard ("Indexed by Envio HyperIndex") | "KOMA: comics you own, and characters whose stories their holders write. On Monad." |
| 0:12 | `/create`: type an idea; Hunyuan's editor answers with a pitch | "Tencent's Hunyuan 3 is the editor. Talk it through and it pitches the issue." |
| 0:30 | Pay 0.10 AUSD: one signature, no gas; progress → panels ink in | "One AUSD signature on Monad, x402, no gas. Kimi K2.6 writes the script; fal draws it." |
| 0:55 | The minted issue; credits line "Written by Kimi K2.6 · Art by Hunyuan Image 3" | "Minted to me, and it says which models made it." |
| 1:05 | `/launch`: name a character; the Hunyuan Image 3 sheet appears; launch | "A dollar launches the hero as a series: a character NFT with its own wallet, and a coin." |
| 1:30 | Series page: buy $3 gaslessly; the character's earnings tick up | "Trades are one signature and no gas. Forty percent of every fee goes to the character's wallet." |
| 1:45 | Propose an episode (Kimi read the canon first: credits show `get_series_canon`); vote | "Holders write the canon. Kimi reads what's been voted before it writes the next episode. Votes are free signatures." |
| 2:05 | Terminal: `cre workflow simulate koma-canon … --broadcast`; MonadVision tx; the canon board shows "Settled by Chainlink CRE" | "When the window closes, a Chainlink CRE workflow re-checks every signature and weight on Monad and settles the winner on chain." |
| 2:30 | Autopilot panel: turn on (Privy), the policy limits | "Backers can leave it on autopilot. A Privy session signer votes and buys for them, inside a policy Privy enforces." |
| 2:42 | `/room` on a phone: passkey → a draft; open it on the laptop | "Next week's twist stays secret: encrypted to a passkey with Mera. KOMA only ever sees ciphertext." |
| 2:55 | Back to the board | "KOMA. Fans write the canon." |
