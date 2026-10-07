# KOMA on Monad: zero-mock test plan and results

**Stack under test:** an anvil fork of Monad testnet (chain 10143, port 18643, a block a second) with Agora's real
AUSD, Tokenbound and Permit2. KOMA's contracts, Uniswap v4 and the CRE `CanonSettler` are deployed by the real
deploy scripts. The app is a production build (`next start`, :4320). The AI is real: Kimi K2.6 and Hunyuan 3
through fal's OpenRouter endpoint, and Hunyuan Image 3 and FLUX.2 on fal. Envio HyperIndex runs on isolated Postgres
and Hasura. Browser checks run in headless Chromium (Playwright 1.63). The wallet is `scripts/lib/wallet-shim.mjs`,
a real EIP-1193 provider whose signatures and transactions are made with local test keys; it has no popup UI.

**No mocks in the product path.** The labelled mock AI, the MOCK ART images and the fixture autopilot signer were
removed. A missing credential shows an honest "not configured" state. Test doubles remain only inside unit tests:
the CRE SDK's capability mocks, and the virtual WebAuthn authenticator.

**Status key:** PASS = run for real and matched the expected result exactly. UNTESTED = needs a dependency that
doesn't exist here (named). Testnet items are UNTESTED ("awaiting testnet go").

## Pages (each: HTTP 200, clean console, no failed same-origin request, no horizontal scroll at 375 px, no Arbitrum-era copy)

| Item | Correct means | Status | How |
|---|---|---|---|
| `/` home | hero, catalog, Monad copy | PASS | `test:walk` |
| `/series` + tabs + search | featured series, live tape, board, Envio leaderboard | PASS | `test:walk`, `test:envio` V6 |
| `/s/:id` open and graduated series | chart, trade widget, canon board, autopilot panel, Built on Monad | PASS | `test:walk` |
| `/launch` | form, preview, price | PASS | `test:walk`, `test:browser` W6 |
| `/create` chat studio, `/create/form` | editor chat, pitch card, pay sheet | PASS | `test:walk`, `test:browser` W2 |
| `/c/:id`, `/c/:id/read` | issue, credits, reader | PASS | `test:walk`, `test:browser` W3 |
| `/tx/:hash` | the payment, decoded | PASS | `test:walk` |
| `/search`, `/shelf`, `/receipts`, `/how` | results, owned issues, receipts, explainer | PASS | `test:walk` |
| `/room` | locked state, then the room | PASS | `test:walk`, `test:room` |

## API

| Item | Correct means | Status | How |
|---|---|---|---|
| `GET /api/status` | ready, network `koma-localnet`, AUSD, launchpad addresses, AI routes per role | PASS | `test:api` B1, `test:ai` A1 |
| `POST /api/comics` (invalid orders) | 400 with specific errors, no quote | PASS | `test:api` B2 |
| `POST /api/comics` (402 quote) | x402 v2, `exact`, AUSD, pages × $0.10, payTo, domain "Agora Dollar"/1 | PASS | `test:api` B3/B3b |
| paid order, replay, metadata | 202 + job; exactly $0.10 moved; replay refused; ERC-721 metadata | PASS | `test:api` B4–B10 |
| underfunded payer | 402 insufficient balance, no job | PASS | `test:api` B7 |
| wrong-amount signature | 402, no charge | PASS | `test:api` B5 |
| `POST /api/chat` | a real Hunyuan reply and a valid priced pitch; 503 when no editor is configured | PASS | `test:ai` A2 |
| `POST /api/jobs/:id` retry | a failed paid job restarts with no second charge (≤ 3) | PASS | a real failed job (`cce07d514a`) retried to `done` |
| `POST /api/series` launch | 402 $1 → sheet → one launch tx → indexed | PASS | `test:launchpad` L3–L5, `test:browser` W6 |
| `POST /api/trade/relay` | gasless buy/sell/swap; fixed amounts, min-out, deadline | PASS | `test:launchpad`, `test:browser` W4 |
| `GET /api/canon/:id`, `POST …/vote` | snapshot weight; late buyer and non-holder refused | PASS | `test:launchpad` L9a, `test:browser` W5 |
| `GET /api/canon/due` | closed slots + signed votes, deterministic, no weights | PASS | `test:cre` C3 |
| `GET /api/board` | Envio when configured and caught up, else SQLite | PASS | `test:envio` V5 |
| `GET/PUT/DELETE /api/room` | Ed25519-signed only; ciphertext only | PASS | `test:room` R2/R3 |
| `GET/POST/DELETE /api/autopilot` | off without Privy (503) | PASS | `test:autopilot` P0 |
| autopilot live (enroll, vote, buy, switch off) | Privy signs inside the policy | UNTESTED | needs `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PRIVY_SIGNER_ID` |
| `POST /api/faucet` | Agora's faucet sends 10,000 AUSD | PASS | `test:launchpad` |

## Contracts (Solidity, Foundry)

| Item | Correct means | Status | How |
|---|---|---|---|
| KomaIssues, SeriesFactory, CharacterNFT + ERC-6551, SeriesCoin, BondingCurve, RoyaltyRouter, Graduator, KomaSwapper, CanonRegistry | 168 unit + fuzz tests on real AUSD-shaped and Tokenbound bytecode | PASS | `forge test` |
| CanonSettler (CRE receiver) | forwarder-only, empty report, replay skipped, registry rules, no role → nothing, pinned workflow id, fuzzed batches | PASS | `forge test` (9) |
| Fork tests vs live Monad testnet | AUSD, Tokenbound, v4 deploy, withdrawals, admin | PASS | `FORK_TESTS=1 forge test` (5) |
| Static pass | slither: no high; 2 medium + 6 low triaged (below) | PASS | `slither .` |

**Slither triage.** `uninitialized-local` (`paidAncestors`, an intentional zero accumulator) is now explicit.
`unused-return` (`poolManager.settle()`) is the standard Uniswap v4 pattern. The `shadowing-local` findings are
parameter names in interfaces. `timestamp` is the deadline check, by design.

## On-chain flows (local fork, real signed transactions)

| Flow | Correct means | Status | How |
|---|---|---|---|
| Launch → buy → sell → curve completes → graduate to v4 → pool swap | balances, fees, pool seeded and locked | PASS | `test:launchpad`, `check-economics` |
| Fee split 40/20/40 + graduation fee + royalties up the remix tree | exact on chain | PASS | `check-economics` 9/9 |
| Anti-snipe cap | > 2% to one wallet in 10 min refused | PASS | `test:launchpad` L11 |
| Propose → vote → window closes → **CRE** settles | report via MockKeystoneForwarder → CanonSettler → `finalize`; votes root equals the keeper's; UI badge | PASS | `test:cre` 7/7 |
| Keeper fallback | finalizes only after `KOMA_CANON_GRACE_S` in CRE mode; immediately otherwise | PASS | `test:cre` C3; `test:launchpad` L9 in keeper mode |
| `cre workflow simulate` | the CLI run | UNTESTED | needs `cre login` |

## AI (real models)

| Item | Correct means | Status | How |
|---|---|---|---|
| Routes | script `kimi:moonshotai/kimi-k2.6 via fal`, editor `hunyuan:tencent/hy3 via fal`, image fal + Hunyuan Image 3 | PASS | `test:ai` A1 |
| Editor turn | real Hunyuan reply + valid pitch | PASS | `test:ai` A2, `test:browser` W2 |
| Script + credits | written by Kimi; cover by Hunyuan Image 3 | PASS | `test:ai` A3, `test:browser` W3 |
| Episode tool call | Kimi called `get_series_canon` | PASS | `test:ai` A4 |
| fal content-filter refusal | retried with a softened prompt | PASS | a real refusal ("could not be processed") recovered in `test:browser`; unit `soften` |
| Direct Moonshot / TokenHub routes | same code, direct keys | UNTESTED | needs `MOONSHOT_API_KEY`, `HUNYUAN_API_KEY` |

## Sponsor surfaces

| Item | Correct means | Status | How |
|---|---|---|---|
| Envio indexer | synced; parity with chain and the app on every series; live trade < 5 s; CRE settlements | PASS | `test:envio` 7/7 |
| Envio Cloud / HyperSync on testnet | hosted | UNTESTED | awaiting testnet go + `ENVIO_API_TOKEN` |
| Mera Writers' Room | ciphertext only; signed requests; stateless rebuild; per-passkey rooms; studio handoff | PASS | `test:room` 7/7 |
| Mera cross-device | one synced passkey on two devices | UNTESTED | needs two real devices |
| Privy login + sponsored gas | embedded wallet, `sponsor: true` | UNTESTED | needs `NEXT_PUBLIC_PRIVY_APP_ID` + dashboard sponsorship |

## Browser flows (real UI, real signatures)

| Flow | Status | How |
|---|---|---|
| Connect | PASS | `test:browser` W1 |
| Studio → x402 → minted issue | PASS | W2 |
| Credits on the issue page | PASS | W3 |
| Gasless buy in the trade widget | PASS | W4 |
| Canon vote on the canon board | PASS | W5 |
| Launch a series from `/launch` | PASS | W6 |
| Autopilot honestly off | PASS | W7 |
| Clean console and network across all of it | PASS | W8 |

## Fixed during this pass

- The fork's clock was warped by the tests → x402 authorizations "expired" (reported as a token-name mismatch).
  The tests now wait in real time.
- Kimi's reasoning used up `max_tokens` → an empty script. Reasoning is now off for Kimi on the fal route.
- Hunyuan without reasoning leaked the pitch JSON into its reply. Reasoning stays on for Hunyuan, and a leaked
  reply is retried.
- fal's content filter refused a noir panel prompt → the retry softens the prompt.
- A failed paid job had no recovery → a **Try again** button (no second charge).
- The launch studio 404'd `/api/series/:id` while indexing → it now polls `/api/launches/:id` → `indexed`.
- Hunyuan Image 3 spend was estimated at the FLUX.2 rate → priced at $0.10/MP, and covers are switchable.
- The injected test wallet exposed accounts before a connect request → it now behaves like a real wallet.
