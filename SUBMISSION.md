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
_Filled in after the testnet run._
<!-- evidence:end -->
