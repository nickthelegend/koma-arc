# KOMA — Arc Microgrants submission

Live: https://koma-arc.vercel.app (Arc mainnet, chain 5042)


| | |
|---|---|
| **Project** | KOMA: comics fans own, and characters whose stories their holders write |
| **Network** | Arc mainnet (5042), contracts in [`deployments/arc-mainnet.json`](deployments/arc-mainnet.json); hosted read-only checks in [HOSTED-MAINNET.md](docs/HOSTED-MAINNET.md). |
| **Repo** | `koma-arc` (MIT) |

## Description (DoraHacks, ≤150 words)

KOMA turns fandom into ownership, paid entirely in USDC on Arc. Describe a story: an AI editor (Hunyuan 3) shapes it
into a pitch, Kimi K2.6 writes it, fal draws it, and for ten cents of USDC (one x402 signature, no gas) the issue is
minted to you, final on inclusion. Launch its hero as a series and the character becomes an economy: a
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
  ~0.01 USDC of gas each on testnet (measured 0.0098), under the 0.015 USDC fee on a $1 trade, which is why
  the relayer floor is $1.
- **Deterministic finality.** Drawing starts the moment the payment's block lands; no confirmation counts anywhere
  in the code. Testnet blocks arrive about every 0.5 s; measured server-side send-to-receipt was 0.8-3.0 s
  (docs/E2E-TESTNET.md).
- **CCTP V2 + Forwarding Service.** A character's ERC-6551 wallet burns its USDC on Arc in one `executeBatch` and
  Circle mints it on the destination chain. (Fork-verified only; not part of the live testnet run.)
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
**Live on Arc testnet (2026-10-13/14):** the full contract set is deployed (24 txs, 0.83 USDC; addresses in the
README) and a real end-to-end run was made against it with real USDC: an x402 payment and mint, a series launch, a
gasless buy and sell, and a keeper-finalized canon vote. Every transaction is linked in
[docs/E2E-TESTNET.md](docs/E2E-TESTNET.md); the judge pass is in [docs/JUDGE-REPORT.md](docs/JUDGE-REPORT.md).

Earlier, on a **fork of Arc testnet** made with Circle's Arc Foundry (`arc-anvil --network arc`, `scripts/local-fork.sh`)
(this is **not** live evidence): the full launchpad suite incl. graduation into v4, the CCTP burn from a character wallet,
the browser flows, and the Writers' Room.

| Suite | Where | Result |
|---|---|---|
| `forge test` (unit + fuzz, FiatToken v2.2 at Arc's USDC address, real Tokenbound + Uniswap v4) | local | 161 passed |
| `test:launchpad` L1-L9 (x402 launch, gasless buy/sell, slippage/tamper, canon proposal, votes, keeper finalize) | **live testnet** | 14/14 |
| `test:api` B2/B3/B5/B7/B8/B9/B11 (x402 quotes, tamper, zero balance, listing, art) | **live testnet** | 8/8 |
| `test:ai` (Hunyuan editor, Kimi + `get_series_canon`, fal) | **live testnet** | see E2E-TESTNET |
| `test:walk` (17 pages at 390 px incl. series/creator/embed with data) | **live testnet** | 17/17 |
| `test:launchpad` L10 remix, L12 graduation into v4 + gasless pool buy, L13 CCTP burn | fork only | passed on the fork (not re-run live) |
| `test:browser`, `test:room` | fork | 8/8, 7/7 (+1 skipped: cross-device) |
| typecheck, lint, `next build` | local | clean |

Measured on Arc testnet (live): x402 settlement 87,177 gas (0.0022 USDC), relayed curve buy 393,418 gas (0.0098 USDC),
relayed sell 310,498 gas (0.0078 USDC), series launch 5.35M gas (0.134 USDC), all at 25 gwei. The Tokenbound
`executeBatch` CCTP burn (184k gas) was measured on the fork.
<!-- evidence:end -->

<!-- MAINNET-ADDRESSES -->
## Addresses — live mainnet and testnet

Mainnet **5042: Live**, deployed 2026-10-14. [All mainnet addresses and transaction receipts](docs/MAINNET-DEPLOYMENT.md).
Testnet **5042002: Live**; [testnet deployment](deployments/arc-testnet.json) and [testnet evidence](docs/E2E-TESTNET.md).

- accountImpl: [0x41C8f39463A868d3A88af00cd0fe7102F30E44eC](https://explorer.arc.io/address/0x41C8f39463A868d3A88af00cd0fe7102F30E44eC).
- accountProxy: [0x55266d75D1a14E4572138116aF39863Ed6596E7F](https://explorer.arc.io/address/0x55266d75D1a14E4572138116aF39863Ed6596E7F).
- canonRegistry: [0xfcf72128e281300b7d68E03C447c36E4db0bf251](https://explorer.arc.io/address/0xfcf72128e281300b7d68E03C447c36E4db0bf251).
- characterNft: [0xc7Da0136fef62c05e96379FFf6990af4FEFb50F1](https://explorer.arc.io/address/0xc7Da0136fef62c05e96379FFf6990af4FEFb50F1).
- curveMath: [0xB0653AF8B867C54e31DB2d8C8aA672Ced8D53A06](https://explorer.arc.io/address/0xB0653AF8B867C54e31DB2d8C8aA672Ced8D53A06).
- erc6551Registry: [0x000000006551c19487814612e58FE06813775758](https://explorer.arc.io/address/0x000000006551c19487814612e58FE06813775758).
- graduator: [0xb6E2786a8c089F2F39e5252d98D0ACc8dFe76000](https://explorer.arc.io/address/0xb6E2786a8c089F2F39e5252d98D0ACc8dFe76000).
- komaIssues: [0xe4c8bAc6BA2CbEC951b678851e1f65abb4aa9e4A](https://explorer.arc.io/address/0xe4c8bAc6BA2CbEC951b678851e1f65abb4aa9e4A).
- permit2: [0x000000000022D473030F116dDEE9F6B43aC78BA3](https://explorer.arc.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3).
- poolManager: [0xC41282dE4e924D1813b0b187e4c8c79e822CcB72](https://explorer.arc.io/address/0xC41282dE4e924D1813b0b187e4c8c79e822CcB72).
- positionManager: [0xd0719483Db7EfB8bBFF769C4E4DB2C027528ACFB](https://explorer.arc.io/address/0xd0719483Db7EfB8bBFF769C4E4DB2C027528ACFB).
- royaltyRouter: [0x2B9559c5c6103A5Fe4C0f8B67c43840D5708C2aB](https://explorer.arc.io/address/0x2B9559c5c6103A5Fe4C0f8B67c43840D5708C2aB).
- seriesFactory: [0x8808BF690f5b9265AcAF5Fb7759E73073606d551](https://explorer.arc.io/address/0x8808BF690f5b9265AcAF5Fb7759E73073606d551).
- swapper: [0x6B2aE35cE75BCFC576496FFcD13898f111f52E71](https://explorer.arc.io/address/0x6B2aE35cE75BCFC576496FFcD13898f111f52E71).
- v4Quoter: [0x1761210F0dD743B207BbF3c8d2aA957D1EeAb607](https://explorer.arc.io/address/0x1761210F0dD743B207BbF3c8d2aA957D1EeAb607).

Mainnet smoke: [Smoke: 0.01 USDC controlled treasury payment](https://explorer.arc.io/tx/0x8416dc577893b93b339a73313ee1fb9c2b3691488f9e95f1c5d765d490a4ec86).

Mainnet smoke: [Smoke: mint one issue from paid receipt](https://explorer.arc.io/tx/0x94bea20a154aad544c10dd9e2f350d5236acbb316d634a158b1bd58aaab58cc3).
<!-- /MAINNET-ADDRESSES -->

## Production network

Live: https://koma-arc.vercel.app (Arc mainnet, chain 5042). [Hosted mainnet checks](docs/HOSTED-MAINNET.md). Hosted mode is a mainnet reader. Generation, minting, trading and voting require the on-demand local studio. Prior-network comics are not mixed into mainnet results. No mainnet transactions were sent during the hosting migration. Historical **Live (testnet)** and **Fork** results elsewhere in this document are separate evidence, not production smoke results.
