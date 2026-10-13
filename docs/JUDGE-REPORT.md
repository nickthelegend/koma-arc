# Judge + fix pass (Arc testnet, 2026-10-14)

Strict reading of the DoraHacks criteria, then fixes. Evidence: [E2E-TESTNET.md](E2E-TESTNET.md), screenshots in
[`screens/testnet/`](screens/testnet).

## Scores (/10)

| Criterion | Before | After | Why |
|---|---|---|---|
| Relevance to Arc | 7 | 8 | Before: USDC-as-gas, x402 on Arc USDC, CCTP, canonical-address deploys all real in code, but SUBMISSION still said "testnet deploy: pending" and finality was claimed as "under a second". After: everything central is proven live (x402, USDC gas, gasless relayed trades, keeper finalize); finality and gas numbers are measured; CCTP/graduation honestly marked fork-only. |
| Technical credibility | 6 | 8 | Before: evidence was fork-only, gas figures came from the fork, two claims were wrong (see below). After: 14/14 launchpad checks, 8/8 API checks, 4/4 AI checks and 17/17 page walk on the live deployment, 6 real tx classes linked with measured gas. Left: CCTP, graduation and the Gateway/CCIP extras were never run live. |
| Quality of what was built | 8 | 8 | Series, creator, embed, OG, recap pages render correctly with real data (no fixes needed); contracts 161 tests. Not raised: NFT `tokenURI` still points at localhost until hosting. |
| Worth taking further | 8 | 8 | Clear mainnet path (one script, guards, dry-run), real economics (character wallet earns, remix tree), but no hosted instance yet. |

## Claims audit (README, SUBMISSION, app copy)

| Claim | Status | Action |
|---|---|---|
| Testnet deploy of all contracts | Live (24 txs) | SUBMISSION's "deploy: pending" removed |
| x402 EIP-3009 payment on Arc USDC, minted issue | **Live** (2 issues) | none |
| Series launch in one tx (NFT + ERC-6551 wallet + coin + curve) | **Live** | none |
| Gasless buy / sell, tamper + slippage + $1 floor | **Live** | none |
| Canon vote finalized on chain by keeper with votes root | **Live** | none |
| Kimi / Hunyuan 3 / Hunyuan Image 3 / FLUX.2 pipeline, `get_series_canon` tool call | **Live** (fal) | none |
| "Final in under a second", "mint confirms in under a second" | **False as measured**: blocks ~0.5 s, KOMA's send-to-receipt 0.8-3.0 s | Reworded in README, SUBMISSION, /how, Built-on-Arc panel, code comments |
| "Relayed buy ~0.008 USDC, pays its way from $1" | Fork number; live is 0.0098 at 25 gwei, and KOMA's 40% fee share (0.006) is below the gas | Live figure used; the subsidy is stated |
| "Ethereum comparison" on speed receipts | Computed live, not invented, but unlabelled | Labelled "est.", with the formula and both data sources in the receipt's details |
| "Arc mainnet has no ERC-6551 / Tokenbound" | **Partly false** on 2026-10-14: the registry exists on mainnet, the accounts do not | README + MAINNET.md corrected |
| CCTP withdrawal "to any chain" | Fork-only burn; destination list is five chains, not "any" | Home panel and Built-on-Arc row say five chains + "verified on a testnet fork" |
| Graduation into a locked v4 pool | Fork-proven only | Labelled in README table and Built-on-Arc panel |
| Envio indexer / HyperSync for Arc | Not run against Arc testnet | README reworded; home panel already said "hosted indexing pending" |
| Circle Gateway funding, CCIP canon receipts | Off by default, never run live | Added to the Arc-stack table as "never run live"; `/receipts` says "off by default, nothing sent" |
| "Security review" link | Self-review by Claude, not an external audit | Link text says so |
| /how example 402 shows EIP-712 name "USD Coin" | **Wrong**: Arc USDC's domain name is `USDC` (the code uses it) | Fixed |
| NFT metadata resolvable | **False on testnet**: `tokenURI` is `http://localhost:4310/...` | Documented as a known limit; fix is `setBaseURI` after hosting; e2e check B10 now compares paths |

README's Arc-stack table gained a "Verified" column (live / fork / never run) for every row.

## Mocks audit

grep for mock/stub/fake/placeholder/sample/TODO/simulate in `src/` (non-test): no mock data, no TODOs. Matches were
`simulateContract` (viem), "todo" progress-step state, and an explicitly dashed "no trades yet" chart placeholder. The AI
recap on series pages is real model output and is labelled with the model. No lorem, no hard-coded numbers shown as live
(`/receipts` figures come from the SQLite index of real txs).

## Screens audit

17 routes walked at 390 px on real testnet data (home, series list/detail, launch, create, create/form, comic, reader,
tx, embed, creator, search, shelf, receipts, how, room): no console errors, no failed requests, no horizontal overflow,
no broken images, all explorer links on explorer.testnet.arc.io (or the in-app `/tx` viewer), no Monad/MON/AUSD/Arbitrum-One
text. `scripts/e2e-walk.mjs` now also checks broken images and explorer hosts and accepts `WALK_WIDTH` / `WALK_SHOTS`.
The series / creator / embed / OG / recap pages, previously only compiled, were rendered against live series #1 and
needed no fixes. Not rendered: the speed-receipt block (appears only after a wallet-driven action in the studio or
trade widget); it type-checks and builds, and its API output was checked.

## What is still weak

* Not hosted: judges must run it locally, and NFT metadata URIs point at localhost.
* Graduation, the CCTP withdrawal to Base and the remix flow have fork evidence only.
* Gateway funding and CCIP canon are code-and-mock only.
* Canon tally runs on KOMA's server (a votes root makes errors detectable, not impossible).
