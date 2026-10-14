# Live Arc testnet run (chain 5042002)

Run on 2026-10-13/14 against the deployment in [`deployments/arc-testnet.json`](../deployments/arc-testnet.json), with
`KOMA_RPC=https://rpc.testnet.arc.io`, the app served locally on :8610 (built from this repo, fresh SQLite index) and the
existing suites: `scripts/e2e-launchpad.mjs only=L1..L9`, `scripts/e2e-api.mjs`, `scripts/e2e-ai.mjs`, `scripts/e2e-walk.mjs`.
All art/scripts came from the real models via fal (Kimi K2.6, Hunyuan 3 editor, Hunyuan Image 3 sheets/covers, FLUX.2 panels).
Explorer: <https://explorer.testnet.arc.io>.

## Transactions

| Step | Tx | Gas | Fee (USDC, 25 gwei) | KOMA server send-to-receipt |
|---|---|---|---|---|
| Fund test wallets (deployer, 2.5 USDC in total) | [creator](https://explorer.testnet.arc.io/tx/0x1c73436a3edac66e29b639e751cce08c28698f44c0e9fc5e8752ef64ff952bda) · [agent](https://explorer.testnet.arc.io/tx/0x9e50224d4dfa410d007b0eabba07b79323d6c5d984f373548c79b96635da57ba) · [agent top-up](https://explorer.testnet.arc.io/tx/0x1d3349c397e32fde2ea989e0ca08958cef2c1427c8e926129a2ff26dfaf0d661) | | | |
| 1. **x402 (EIP-3009) payment** for a series episode, $0.30, settled by KOMA's facilitator | [0x1680a8…7e59](https://explorer.testnet.arc.io/tx/0x1680a8fda50f22c00a8ef64ce4ee94574b92f35966105941c663afb7801e7e59) | 87,177 | 0.0022 | 1,790 ms |
| 2. **Mint** of issue #1 in KomaIssues, bound to that payment | [0xe90506…3fdd](https://explorer.testnet.arc.io/tx/0xe905067a9386afc574870d33bfd2acfd70a9e8d76a8e297ea03252ec1cf63fdd) | 191,386 | 0.0048 | 832 ms |
| 1+2 again: plain x402 issue #2 ("The Special", $0.10, no series) | [payment 0xe2e139…2d14](https://explorer.testnet.arc.io/tx/0xe2e1399ec830cd0d598fa91c617e7beff5b1a53bfc0c9620b6e3126cb94d2d14) · [mint 0x126284…73eb7](https://explorer.testnet.arc.io/tx/0x1262848d664717926a007ec08fb639a7dcc5151cb0f91e79998844ca97c73eb7) | | | 2,152 ms (payment) |
| 3. **Series launch** ($1 x402 → Character NFT #1 + ERC-6551 wallet + `$RUST` coin + bonding curve, one tx) | [0x57f430…899e](https://explorer.testnet.arc.io/tx/0x57f430b3d2aaf19c22f2ab36925327d328ce682ef51b7409b6875a3f0eb6899e) | 5,347,775 | 0.1337 | 3,014 ms |
| 4a. **Gasless buy** ($2.50, one USDC `ReceiveWithAuthorization`, buyer paid no gas, 2.46M coins) | [0x4acee7…20fb](https://explorer.testnet.arc.io/tx/0x4acee7bd53187f51d7bc3814d5af61cc7ea80fd42ac1f5946f37c2cfd59020fb) | 393,418 | 0.0098 | 1,332 ms |
| 4b. **Gasless sell** (permit + signed intent, 1.23M coins for 1.214 USDC) | [0xce7729…19f2](https://explorer.testnet.arc.io/tx/0xce7729a55fe7e6a4f14e57d39d79f2539bd09c26dd62b48bfcf6d286991d19f2) | 310,498 | 0.0078 | 1,313 ms |
| 5. **Canon finalized by the keeper** (episode 1 → issue #1, votes root `0xefd833…cf3f`) | [0x2186a5…0436](https://explorer.testnet.arc.io/tx/0x2186a5e76f594e8cd7c5a1061f7e8329447a3e508012f1840a3644f5d0480436) | 67,662 | 0.0017 | 1,774 ms |

Addresses: series #1 coin `0x675CdC70450644F16774dF88783Bf857C23Ea634`, curve `0x90422F141A58aF1390e93eDEE50dCbeb9cB478f0`,
character wallet `0x66c92E89C06e695F5c322cecE143d43489208Dc8`.
(The L9 late-buy by the creator and the relayed buy checks were also real transactions; hashes are in the app's trade list.)

## Results

| Suite | Result |
|---|---|
| `test:launchpad` L1 L2 L3 L4 L4b L5 L6 L6b L7 L7b L8a L8 L9a L9 | 14/14 pass |
| `test:api` B2 B3 B3b B5 B7 B8 B9 B11 (no-AI-spend checks) | 8/8 pass |
| `test:ai` A1-A4 | 4/4 pass (A3 after the plain issue #2 existed) |
| `test:walk` 17 pages at 390 px, real series #1 / issue / creator / embed data | 17/17 pass; screenshots in [`docs/screens/testnet/`](screens/testnet) |
| OG image `/s/1/opengraph-image` | 200 `image/png`, 388 KB ([`og-series-1.png`](screens/testnet/og-series-1.png)); recap API `/api/series/1/recap` returned the Kimi-written recap |

## Measured, and what it changes

* Finality: testnet blocks arrive about every 0.5 s (1,000 blocks in 507 s). KOMA's own send-to-receipt measurement
  (includes simulate + RPC round trips from the server, so it overstates chain latency) was 0.8-3.0 s. The app no longer says
  "under a second"; `/receipts` shows the measured median (1,790 ms in this run).
* A relayed buy costs 0.0098 USDC of gas, under the 0.015 USDC fee on a $1 trade; KOMA's own 40% share of that fee (0.006)
  is less than the gas, so the $1 floor is a (small) subsidy.
* The "Ethereum comparison" on KOMA's speed receipts is an estimate: this tx's gas units x Ethereum mainnet's current
  `eth_gasPrice` (ethereum-rpc.publicnode.com) x the Coinbase ETH-USD spot price, cached 10 minutes. It is labelled as such;
  for the live buy it computed $0.064 at 0.064 gwei. Nothing is hard-coded.

## Not run live (labelled in README, app copy and report)

* Graduation into Uniswap v4 and the swapper's gasless pool buy: fork-proven only.
* CCTP burn from the character wallet (L13a) and the Circle attestation + Base Sepolia mint (L13b): burn passed on a fork only.
* Remix royalties (L10), Writers' Room and browser-wallet suites: fork.
* Circle Gateway funding and CCIP canon receipts: off by default, never run live.
* NFT metadata: `tokenURI` of the deployed KomaIssues / CharacterNFT points to `http://localhost:4310/api/...`, the origin the
  deploy script was given, because the app is not hosted. Anyone with the admin role (the deployer) can call `setBaseURI` once a
  public URL exists; until then an explorer cannot show the images.

## Funds

2.5 USDC sent from the deployer; 3.32 USDC swept back from the test wallets and server at the end (they also earned x402
payments and fees), leaving 0.02-0.3 USDC in each for local demos. Keys remain in `.env.local` (git-ignored).

## Round 2 — real browser generation and public metadata (2026-10-14)

LEAD: RUN THESE
```sh
node scripts/e2e-browser-koma.mjs
# With the local studio on :8610, using the testnet deployment and .data.t8610:
KOMA_URL=http://localhost:8610 node scripts/e2e-browser-koma-core.mjs
KOMA_DATA_DIR=.data.t8610 node scripts/export-testnet-archive.mjs
KOMA_PUBLIC_URL=https://koma-arc.vercel.app node scripts/set-testnet-base-uri.mjs
```

The core script installed a real EIP-1193 wallet in Chromium (automated approval, real signatures), connected through the UI,
entered a story in `/create/form`, chose one page, accepted the 0.10 USDC quote, signed the x402 payment, waited for real
Kimi/FLUX/Hunyuan artwork and the mint, then clicked **Read it**. NFT #4 ownership and payment/mint receipts were verified
against Arc testnet. The server restarted during a config edit and resumed the same paid job; no second payment was requested.

| Step | Live testnet evidence |
|---|---|
| Fund temporary browser wallet with 0.25 USDC | [fund](https://explorer.testnet.arc.io/tx/0x1e20bcd4d0295f47468ac1684301781095125bc8f490c4e4d787b77156b8cb00) |
| Browser-authorized 0.10 USDC x402 payment | [payment](https://explorer.testnet.arc.io/tx/0x568987798808f4f4d7e5c19bbaae74056f549e1b89e5f53aa3e3fd176510ecce) |
| Mint NFT #4, issue `803de0cd20` | [mint](https://explorer.testnet.arc.io/tx/0xd67955b398ec7b362db1102b7894e30caa9344d5aad03773a76d5e2e94dc5a93) |
| Sweep unused USDC to deployer; wallet balance now exactly zero | [sweep](https://explorer.testnet.arc.io/tx/0x11002f957fb3124146a53d082b3e4bda115f9329cd6c53a965e3c7bdca010912) |

Private test key remains in ignored `.env.round2` (mode 0600). Screenshots and receipt/fee details:
[`core-results.json`](screens/testnet/core-results.json), `core-paid.png`, `core-minted.png`, `core-reader.png`.
The public archive contains three verified comics (#1, #2, #4) and the character sheet for series #1; token #3 has no local
artwork, so its metadata reads the real on-chain hash/payment and explicitly says the artwork has not been published here.
Hosted AI generation remains **unavailable**, visible before payment; the browser generation proof used the local studio.

Both testnet NFT base URIs were updated to the deployed origin after HTTP 200 metadata/image checks:
- KomaIssues: [setBaseURI](https://explorer.testnet.arc.io/tx/0x815fc7541ba07b8911bcf32d1a035a4969140e0ac3c3a11ba2e1dc142689fd6f).
- CharacterNFT: [setBaseURI](https://explorer.testnet.arc.io/tx/0xbf07a696a620024eedd510ccaedc7d53a057bf7d2a507358b38482fa35471d4b).

All four issue metadata endpoints and character #1 return HTTP 200 at https://koma-arc.vercel.app.
Issues #1/#2/#4 and character #1 return real image URLs; #3 explicitly reports unpublished artwork.
Total round-2 spend: **0.10971625 USDC**, comprising the 0.10 payment and 0.00971625 in six transaction fees,
well below the 1 USDC cap. 0.149475 USDC returned from the temporary wallet. No mainnet transaction or paid hosting resource.

The Vercel route audit passed **36/36** route/viewport combinations at 1440 and 390 px with no console errors,
failed same-origin requests, overflow or broken images. An initial interaction assertion had a desktop-only button label;
this was a test locator error, corrected to include mobile “Pay & draw”. Full page results (including that initial harness
failure) remain in `screens/testnet/round2/results.json`; focused interaction rerun is in `round2-interactions/results.json`.
Focused interaction rerun: **9/9 passed**, including disabled payment on an intentionally failed status request.
