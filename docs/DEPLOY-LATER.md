# KOMA on Monad: going live (runbook)

Everything below is **on hold until the owner says go**. Today KOMA runs end to end on a local anvil fork of Monad
testnet (real AUSD, Tokenbound and Permit2, a locally deployed Uniswap v4, real AI) and nothing has touched Monad
testnet itself. This is the ordered list from "go" to a live, judge-ready deployment. Target: **under one hour**,
most of it waiting on transactions and builds.

Who does what: **Owner** = the person with the accounts and keys (never pasted into chat or git). **Claude** =
the coding session, which runs the commands once the owner has set the secrets.

## 0. Before "go" (owner, ~15 min, once)

| What | Where | Why |
|---|---|---|
| **About 15 MON** to `0x2318FcA151391251E9c691638aCfb342AEec694c` | faucet.monad.xyz (or a transfer) | The deployer, relayer and facilitator key (its private key is in `.env.testnet`, local only). Monad charges the **gas limit**, and the deploy includes Uniswap v4 (PoolManager, PositionManager, V4Quoter), which testnet lacks. ~8 MON deploys everything; the rest pays for gasless trades, x402 settlements, launches and the keeper. |
| **0.5 MON** to a fresh "CRE key" (`cast wallet new`) | same | Pays the `cre workflow simulate --broadcast` writes. Put its key in `cre/.env` as `CRE_ETH_PRIVATE_KEY` (gitignored). |
| `FAL_KEY` | already in `.env.local` | Art on fal, and Kimi + Hunyuan through fal's OpenRouter endpoint. Top up the fal balance if it is low; a 1-page issue costs ~$0.03 to make, a launch ~$0.02. |
| `MOONSHOT_API_KEY`, `HUNYUAN_API_KEY` (optional) | platform.moonshot.ai · Tencent TokenHub (intl) | Direct API routes for Kimi and Hunyuan; without them the same models run through fal. |
| Privy app | dashboard.privy.io | Create an app; **enable gas sponsorship for Monad Testnet**; login methods email, Google, passkey, wallet; add the app's URLs to allowed origins. Create an **authorization key** and a **key quorum** with it (the session signer). You get `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PRIVY_SIGNER_ID`. |
| Envio | envio.dev/app | An account (for Envio Cloud hosting) and an API token (`ENVIO_API_TOKEN`) for HyperSync. |
| `cre login` | terminal, opens a browser | Chainlink CRE simulation. Deploying a workflow to the DON also needs `cre account access` approval. |
| Railway | railway.com | Hosting for the app (long-running Node with a volume for SQLite and art). |
| GitHub | github.com | Create the **public** repo `koma-monad` (MIT) when the owner says so. |

## 1. Push the code (Claude, 2 min)

```bash
git remote add origin https://github.com/<owner>/koma-monad.git
git push -u origin main
```

## 2. Deploy and verify the contracts on Monad testnet (Claude, 10 min)

```bash
cd contracts
KEY=$(grep ^SERVER_PRIVATE_KEY= ../.env.testnet | cut -d= -f2)
APP=https://<railway-or-vercel-host>          # step 4's URL; it is baked into token metadata
DEPLOYER_KEY=$KEY ALLOW_EOA_ADMIN=true TREASURY=0x2318FcA151391251E9c691638aCfb342AEec694c RELAYER=0x2318FcA151391251E9c691638aCfb342AEec694c \
  BASE_URI=$APP/api/characters/ KOMA_BASE_URI=$APP/api/tokens/ \
  forge script script/DeployLaunchpad.s.sol --rpc-url monad_testnet --broadcast --slow
# → ../deploy/addresses.10143.json (launchpad, KomaIssues, v4 PoolManager/PositionManager/V4Quoter)

ADDRESSES=../deploy/addresses.10143.json DEPLOYER_KEY=$KEY FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192 \
  forge script script/DeployCanonSettler.s.sol --rpc-url monad_testnet --broadcast --slow
# MockKeystoneForwarder: what `cre workflow simulate --broadcast` delivers through. For a workflow deployed to the
# DON, deploy a second settler with FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482 (KeystoneForwarder).
```

Verify every contract on Sourcify (MonadVision reads it):

```bash
for c in $(jq -r 'to_entries[] | select(.value|type=="string" and startswith("0x")) | .key' ../deploy/addresses.10143.json); do echo $c; done   # the list
forge verify-contract --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ <address> <src/File.sol:Contract>
```

Checks (read-only): `cast call <canonRegistry> "hasRole(bytes32,address)(bool)" $(cast keccak RELAYER_ROLE) <canonSettler>` → `true`;
`cast call <seriesFactory> "usdc()(address)"` → AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`.

## 3. The indexer on Envio Cloud (Claude + owner, 10 min)

```bash
cd indexer && npm run config:testnet && npm run codegen   # config.yaml + src/deployment.ts from deploy/addresses.10143.json
git add config.yaml src/deployment.ts && git commit -m "Envio: Monad testnet config" && git push
```

Envio Cloud: new indexer from the GitHub repo, root directory `indexer`, config `config.yaml`. HyperSync covers
Monad testnet natively (`10143.hypersync.xyz`). Copy the GraphQL endpoint for step 4.

## 4. Host the app (Claude, 15 min)

Railway project `koma-monad`, service `web` from the repo, a **volume mounted at `/data`**, start `npm start`.
Variables (the owner sets the secret ones in the Railway dashboard; never in git or chat):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_KOMA_NETWORK` | `monad-testnet` |
| `NEXT_PUBLIC_MONAD_RPC_URL` | `https://testnet-rpc.monad.xyz` (or a keyed RPC; then also `KOMA_SERVER_RPC_URL`) |
| `KOMA_LOGS_RPC_URL` | a keyed RPC if the public one's 100-block `eth_getLogs` cap is too slow |
| `SERVER_PRIVATE_KEY` | **owner**: the deployer key from `.env.testnet` |
| `KOMA_CONTRACT` | `komaIssues` from `deploy/addresses.10143.json` |
| `KOMA_LAUNCHPAD_ADDRESSES` | `deploy/addresses.10143.json` (committed) |
| `KOMA_PUBLIC_URL` | the public URL |
| `KOMA_DATA_DIR` | `/data` |
| `FAL_KEY`, `HUNYUAN_IMAGE=1`, `KOMA_FAL_DAILY_USD=10` | **owner** sets `FAL_KEY` |
| `MOONSHOT_API_KEY`, `HUNYUAN_API_KEY` | **owner**, optional |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PRIVY_SIGNER_ID` | **owner** |
| `ENVIO_GRAPHQL_URL` | the Envio Cloud endpoint from step 3 |
| `KOMA_CANON_FINALIZER=cre`, `KOMA_CANON_GRACE_S=900` | CRE settles canon; the keeper is the fallback |

```bash
railway up --service web --detach
```

Optional front door: `deploy/vercel/vercel.json` rewrites everything to the Railway URL (edit `destination`, then
`vercel deploy --prod` from `deploy/vercel`).

## 5. Chainlink CRE on testnet (Claude, 5 min)

Fill `cre/koma-canon/config.staging.json` (`komaUrl` = the public URL, `canonRegistry` and `receiver` = the
mock-forwarder `canonSettler` from step 2), then from `cre/`:

```bash
cre workflow simulate koma-canon --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

That is a real testnet transaction: the forwarder calls `CanonSettler.onReport`, which finalizes every due canon
slot. Record the tx hash in `SUBMISSION.md`. (To run it on the DON instead: `cre account access`, then
`cre workflow deploy koma-canon --target staging-settings` against the KeystoneForwarder settler.)

## 6. Smoke test (Claude, 10 min)

Against the public URL, with a fresh browser profile and a funded test wallet:

```bash
KOMA_URL=https://<public-url> WALK_SHOTS=0 npm run test:walk          # every page at 375 px, clean console
KOMA_URL=https://<public-url> npm run test:ai                         # real models, credits on real issues
```

By hand (and recorded for the video): connect (Privy email or a wallet) → **Get 10,000 test AUSD** → make a
1-page issue in the studio → open it (credits show Kimi and Hunyuan Image 3) → launch a series → buy $3 gaslessly →
propose an episode → vote → after the window, run step 5 → the canon board shows **Settled by Chainlink CRE** →
`/series` leaderboard shows **Indexed by Envio HyperIndex** → turn on the backer autopilot (Privy) → `/room`:
create a Writers' Room passkey on a phone, open it on a laptop with the same synced passkey.

## 7. Video (≤ 3 min) shot list

See `SUBMISSION.md` → Demo script (timestamps). Record at 1280×800 and one phone segment; no wallet popups thanks
to Privy sponsorship; keep the CRE simulate terminal and the MonadVision tx in frame for 3 s each.

## Addresses that already exist on Monad testnet (from the address book)

| | Address |
|---|---|
| AUSD (Agora) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| AUSD faucet (Agora, `requestFunds`) | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` |
| ERC-6551 registry (Tokenbound) | `0x000000006551c19487814612e58FE06813775758` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| CRE MockKeystoneForwarder (simulate) | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| CRE KeystoneForwarder (DON) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |
