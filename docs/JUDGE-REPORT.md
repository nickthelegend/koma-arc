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

## Round 2 — public product review (2026-10-14)

This section supersedes the earlier hosting/localhost limitations above. Judged the actual Vercel preview and the local studio against **Live (testnet)**, never mainnet. No invented comics, balances or successful transactions.

| Criterion | Before | After | Reason |
|---|---|---|---|
| Arc relevance | 8 | 8 | Real USDC x402 payment and NFT ownership remain the central proof; no new cross-chain claim. |
| Technical credibility | 8 | 8 | Browser payment/mint evidence, verified public metadata and bounded failures; full studio still depends on one local process. |
| Build quality | 6 | 8 | Hosted catalog was empty and several controls promised unsupported actions. Public artwork/archive, disabled actions and explicit recovery states address those defects. |
| Worth taking further | 8 | 8 | Strong readable artifact and character economics; durable serverless generation remains engineering work. |
| Cold judge experience | 4 | 7 | Judges can read actual comics and verify ownership without setup. New generation requires an operator-run local studio, clearly stated before payment. |

### Defects and disposition

- **NFTs pointed at localhost; hosted issue metadata was 404, character metadata lacked art.** Added a receipt-verified testnet archive of public comics/series metadata and artwork. Base URI updater accepts HTTPS, verifies both metadata/image endpoints, pins chain 5042002, caps gas and uses the shared deployer lock.
- **Hosted catalog looked empty despite minted issues.** Archive populates the catalog, comic detail, reader, search, canon covers and token metadata; mainnet never receives the testnet archive.
- **Hosted chat, trade, vote and room controls invited unsupported actions.** Chat/payment controls wait for readiness, hosted trades have an explanatory state, voting is disabled and the room requests no passkey.
- **Status errors were swallowed; generation controls could stay enabled.** Status calls now time out, explain the connection failure and disable payment. `ready` also respects hosted read-only mode even if credentials happen to exist.
- **AI probe treated network/provider errors as healthy.** Timeouts, 429 and 5xx now block payment. Increased probe deadline from 8 to 30 seconds after observing a valid provider response in 22 seconds.
- **Job polling could spin indefinitely or interpret HTTP errors as jobs.** Requests time out, three consecutive failures stop the spinner, and a 12-minute upper bound preserves the job URL with a reload/no-second-payment instruction. Lost payment responses no longer return to a fresh payment prompt.
- **Homepage promised every trade was one free signature and earned character royalties.** Copy now says eligible trades use gasless signatures and characters earn bonding-curve fees. Removed the absolute front-running claim from private drafts.
- **Initial hosted series visit hit one 429.** Recorded as an intermittent provider failure; final audit records every failed same-origin request without filtering it away.
- **Mobile/desktop:** existing comic typography, spacing and responsive composition preserved; screenshots cover every page route, including `/fund`, dynamic comic/reader/tx/creator/embed pages and the graduated empty state. Story starters are editable suggestions, style/cast images are reference choices, not minted items. No mock activity or fabricated examples were added.

### Remaining limits

Hosted generation/trading/voting/private drafts are unavailable. A local Node studio with persistent disk runs the multi-step AI jobs, payment callbacks and keeper; a durable queue/shared journal/art store is required before safe serverless execution. No paid resource was created. The public art archive must be refreshed after new local mints. External AI latency and RPC availability still affect local generation; no live CCIP, Gateway, CCTP destination mint or graduation is claimed in this round. Canon tally remains server-operated and the contracts are not independently audited.

### Round-2 verification

- Typecheck and ESLint: pass. Application unit tests: **32/32**. Arc Foundry contracts: **166/166**.
- Optimized local and Vercel production builds: pass. Existing dynamic-file-tracing warning remains; the Vercel upload excludes env/private data.
- Browser core: **7/7** real-flow assertions; one 0.10 USDC payment, NFT #4, working reader, sweep to zero.
- Initial local desktop route checks: **18/18**; the subsequent interaction wait hit the old 30-second harness deadline while checking AI readiness. Harness deadline corrected to 90 seconds. Local mobile routes/interactions: **22/22**.
- Public metadata: all issue IDs 1–4 and character #1 return HTTP 200. Two successful `setBaseURI` transactions remove localhost from both deployed NFT contracts.
- Evidence: [E2E-TESTNET.md](E2E-TESTNET.md), [core receipts](screens/testnet/core-results.json), [URI receipts](screens/testnet/base-uri-results.json). Total testnet spend including payment and fees: **0.10971625 USDC**.
- Final Vercel page audit: **36/36 route/viewport combinations passed** (18 routes at both 1440 and 390 px), with zero console errors, failed same-origin requests, broken images, stale-chain copy or overflow. The first interaction run used the desktop payment label on mobile; corrected the harness to match the mobile “Pay & draw” button and reran the interaction checks separately. Original observations remain in `screens/testnet/round2/results.json`.
- Focused Vercel interaction rerun: **9/9 passed** — story starters, unavailable-before-payment at both widths, series navigation, comic-reader navigation, and blocked payment after an intentionally failed status request. This last failure injection tests UI recovery only; all chain evidence above is real.
