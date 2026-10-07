# KOMA on Monad: plan

## Goals

- **Done:** every sponsor integration built and verified for real on the local Monad fork, no mocks in the product,
  every suite green, and the judge package written. Deployed to Monad testnet and hosted when the owner says go
  (runbook < 1 hour).
- **Winning (Track 3, Social, Attention & Culture):** a product people would actually use, where culture is the
  mechanic: fans co-own a character, vote its canon, and the character earns. Six bounties stack on top: Hunyuan
  (T3), Kimi, Privy, Envio, Chainlink CRE and Mera Many Keys. Each is in the core path, not bolted on.

## Completion

Scored on the 10 tasks below, weighted equally. 1 = done and verified for real; partial credit where the code is
done but a live check is blocked; 0 = not done.

| Task | Initial (start of the master pipeline) | Final |
|---|---|---|
| Monad port | 1 | 1 |
| Kimi scripts + canon tool | 0.5 (fixture model only) | 1 |
| Hunyuan editor + images | 0.5 (fixture model, mock art) | 1 |
| Privy wallets, sponsorship, autopilot | 0.25 (fixture signer) | 0.5 (code + policy tests; live needs keys) |
| Envio | 1 | 1 |
| CRE | 0.5 (built, fork e2e) | 0.75 (plus browser-visible settlement; `cre simulate` needs login) |
| Mera Writers' Room | 0.5 | 0.75 (cross-device needs two devices) |
| Zero mocks | 0 | 1 |
| One-command demo | 0 | 1 |
| Testnet deploy + hosting | 0 | 0 (awaiting go) |
| **Total** | **4.25 / 10 = 43%** | **8 / 10 = 80%** |

The remaining 20% is all owner-side: Privy credentials, `cre login`, two devices, and the testnet go.

## Phases (critical path in bold)

1. **Port to Monad** (AUSD, address book, v4 on testnet, fork harness). DONE
2. **Sponsor integrations:** AI (Kimi, Hunyuan); Privy; Envio; CRE; Mera. DONE (live keys pending for Privy)
3. **Product audit + zero-mock pass:** browser flows, 375 px walk, mocks removed, real models. DONE
4. **Quality gate:** all suites, lint, typecheck, slither, secret scan. DONE (see `SUBMISSION.md` → Evidence)
5. **Judge package:** README, SUBMISSION, SPONSOR-GAP, DEPLOY-LATER, TEST-PLAN-ZERO-MOCK. DONE
6. **Go live (owner's go):** MON funding → deploy + verify → Envio Cloud → Railway → CRE simulate on testnet →
   smoke test. BLOCKED (awaiting go)
7. **Video (≤ 3 min)** from the demo script. BLOCKED on 6

## Tasks

| Task | Acceptance | Verify | Status |
|---|---|---|---|
| Monad port | everything on AUSD/Monad; no Arbitrum copy | `test:walk` stale-copy check | DONE |
| Kimi scripts + canon tool | episode scripts call `get_series_canon` | `test:ai` A4 | DONE |
| Hunyuan editor + images | editor pitches; sheets/covers by Hunyuan Image 3 | `test:ai` A1–A3, `test:browser` W2/W3/W6 | DONE |
| Privy wallets, sponsorship, autopilot | live enrol → vote → buy under policy | `test:autopilot` P1–P6 | BLOCKED: Privy app credentials |
| Envio indexer + leaderboard | parity + live data + board from Envio | `test:envio` | DONE |
| CRE canon settlement | settled via forwarder; root = keeper's | `test:cre`; `cre workflow simulate` | DONE / BLOCKED: `cre login` |
| Mera Writers' Room | ciphertext only; stateless; per-passkey | `test:room`; two devices | DONE / BLOCKED: two devices |
| Zero mocks | no mock/fixture paths in `src/` | gap grep below | DONE |
| One-command demo | fresh clone → running stack | `npm run demo` from an empty `.data` | DONE |
| Testnet deploy + hosting | live URL, verified contracts | DEPLOY-LATER §6 smoke test | BLOCKED: awaiting go + ~15 MON |

## Gap audit (grep `mock|stub|fake|dummy|placeholder|TODO|FIXME|hardcod` over `src/`)

| Evidence | Impact | Severity | Fix | Status |
|---|---|---|---|---|
| `src/lib/server/providers.ts` mock text/image providers, `public/mock/*` | fake scripts/art in the product | P0 | removed; real routes via fal; "not configured" otherwise | FIXED |
| `src/lib/server/autopilot/signer.ts` fixture signer | in-process signing with test keys | P0 | removed; Privy only; honest 503 | FIXED |
| `.data` from the mock era (MOCK SHEET, mock issues) | fake data shown in the app | P0 | fresh deployment; old data backed up to `.data.pre-zero-mock-*` (gitignored) | FIXED |
| Kimi empty answers (reasoning ate `max_tokens`) | paid jobs failing | P1 | reasoning off for Kimi on the fal route | FIXED |
| fal content filter on panels | paid jobs failing | P1 | soften + retry; "Try again" with no second charge | FIXED |
| Hunyuan Image 3 priced as FLUX in the budget | spend under-counted | P2 | $0.10/MP; covers switchable | FIXED |
| Remaining grep hits | `placeholder=` attributes on inputs; "todo" step states in progress UIs | none | n/a | OK |
