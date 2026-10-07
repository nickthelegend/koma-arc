# KOMA — Arc Microgrants submission

| | |
|---|---|
| **Project** | KOMA: comics fans own, and characters whose stories their holders write |
| **Network** | Arc testnet (5042002), contracts in [`deployments/arc-testnet.json`](deployments/arc-testnet.json); mainnet is one command ([MAINNET.md](MAINNET.md)) |
| **Repo** | `koma-arc` (MIT) |

## Description (DoraHacks, ≤150 words)

KOMA turns fandom into ownership, paid entirely in USDC on Arc. Describe a story: an AI editor (Hunyuan 3) shapes it
into a pitch, Kimi K2.6 writes it, fal draws it, and for ten cents of USDC (one x402 signature, no gas) the issue is
minted to you, final in under a second. Launch its hero as a series and the character becomes an economy: a
Character NFT with its own ERC-6551 wallet that earns 40% of every trade, a coin on a USDC bonding curve with
gasless trades from $1, and a canon holders write together with free signed votes. At its target the curve
graduates into a locked Uniswap v4 pool. Whoever holds the character can send its earnings to Base, Ethereum,
Arbitrum, OP or Avalanche over Circle's CCTP in one Arc transaction. USDC is the only token anyone ever touches.

## What it uses Arc for

- **USDC as gas, USDC as everything.** Payments, trades, curve reserves, fees, royalties and every gas bill are
  the same USDC. No user, creator or server key ever needs a second token.
- **x402 on Arc's USDC.** EIP-3009 `transferWithAuthorization` on `0x3600…0000` (domain `USDC`/`2`), settled by
  KOMA's own facilitator, which other apps can call too. AI agents buy comics from a script the same way.
- **Gasless trading that pays its way.** `receiveWithAuthorization` buys and permit + intent sells, relayed for
  ~0.008 USDC of gas each, so the relayer breaks even from $1 trades.
- **Sub-second deterministic finality.** Drawing starts the moment the payment's block lands; no confirmation
  waits anywhere.
- **CCTP V2 + Forwarding Service.** A character's ERC-6551 wallet burns its USDC on Arc in one `executeBatch` and
  Circle mints it on the destination chain.
- **Arc-native deployment.** Uniswap v4 deployed from Uniswap's bytecode and ERC-6551/Tokenbound replayed at their
  canonical addresses, because Arc mainnet has neither; contracts reviewed against Arc's EVM differences.

## Demo steps

1. Get testnet USDC at <https://faucet.circle.com> (Arc Testnet). Open the app, connect MetaMask/Rabby (Arc testnet
   is added automatically).
2. **/create**: describe a story; the Hunyuan editor pitches it. Pay $0.10 with one signature. Watch it settle on
   Arc, get written by Kimi and drawn; the issue page links the payment and mint transactions.
3. **/launch**: name a character, tick *demo series*, pay $1. The Hunyuan Image 3 sheet appears and one
   transaction mints the Character NFT, its wallet, the coin and the curve.
4. On the series page, buy $1 of the coin: one signature, no gas. The character's wallet ticks up.
5. Propose an episode (Kimi reads the canon first), vote with a free signature; 5 minutes later the keeper
   finalizes it on chain.
6. Buy the demo curve to its 5 USDC target: it graduates into a Uniswap v4 pool; trade there.
7. As the character's owner, **Send to Base Sepolia**: one transaction, then watch Circle's attestation and the
   forwarded mint land on Base.

## Evidence

<!-- evidence:start -->
Run on 2026-10-07. **Arc testnet deploy: pending** — the shared deployer wallet had 0 USDC, so the broadcast stopped
at its first transaction (`insufficient funds … have 0`). Everything else was run for real against a **fork of Arc
testnet** made with Circle's Arc Foundry (`arc-anvil --network arc`, which moves Arc's native USDC; `scripts/local-fork.sh`):
the real deploy script, Arc's real USDC contract, the real CCTP TokenMessengerV2, real AI models.

| Suite | Result |
|---|---|
| `forge test` (unit + fuzz, FiatToken v2.2 at Arc's USDC address, real Tokenbound + Uniswap v4) | 161 passed (also with 10,000–40,000 fuzz runs) |
| Deploy script on the Arc fork | 24 txs, 33,065,114 gas, 0.661 USDC; mainnet path simulated against live Arc mainnet (`DRY_RUN=1`) |
| `test:api` (x402 on Arc USDC, facilitator, minting, real models) | 13/13 (B4 and B12 re-checked after switching to Transfer-log amounts) |
| `test:launchpad` (launch → gasless buy/sell → canon → remix royalties → graduation into v4 → pool swap) | 16/17, the one failure (L8a, an unfunded non-holder) fixed in the suite since |
| CCTP from a character wallet (L13a: `executeBatch` approve + `depositForBurnWithHook`) | passed on the fork (183k gas); the attestation + Base Sepolia mint (L13b) needs the real testnet |
| `test:browser` (UI flows with real signatures) | 8/8 |
| `test:ai` (Kimi script with `get_series_canon`, Hunyuan editor and images) | 4/4 |
| `test:room` (WebAuthn PRF Writers' Room) | 7/7 (+1 skipped: cross-device needs two real devices) |
| `test:walk` (15 pages at 375 px, no stale chain copy) | 15/15 |
| typecheck, lint, `next build` | clean |

Measured on Arc: x402 settlement 87k gas (0.0018 USDC), relayed curve buy 393k gas (0.008 USDC), Tokenbound
`executeBatch` CCTP burn 184k gas.
<!-- evidence:end -->
