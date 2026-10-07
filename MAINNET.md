# KOMA on Arc mainnet: runbook

Everything below is one command per step. Nothing here has been broadcast to mainnet yet; the same script and
contracts are live on Arc testnet (`deployments/arc-testnet.json`), and the mainnet path has been simulated against
the live Arc mainnet state (`DRY_RUN=1`, see §2).

## 0. What gets deployed

`contracts/script/DeployLaunchpad.s.sol`, in one run, in this order:

1. **ERC-6551 registry + Tokenbound v0.3** at their canonical addresses (registry `0x000000006551c19487814612e58FE06813775758`,
   AccountGuardian, ERC-2771 multicall forwarder, AccountV3 `0x41C8…44eC`, AccountProxy `0x5526…6E7F`), replayed
   through the deterministic deployer from the Ethereum init code in `contracts/script/erc6551/`. Arc mainnet has
   none of them today; each is skipped if it already exists.
2. **Uniswap v4** PoolManager (owner = `ADMIN`), PositionManager and V4Quoter from Uniswap's published artifacts
   (Arc has no Uniswap deployment). Permit2 is already at its canonical address.
3. `CurveMathReference`, `RoyaltyRouterReference`, `KomaIssues`, `CharacterNFT`, `CanonRegistry`, `Graduator`
   (CREATE2 at a mined hook address), `SeriesFactory`, `KomaSwapper`; roles wired; every admin role handed to
   `ADMIN`; the deployer renounces everything (checked in `_postCheck`).

Mainnet guards (in the script, tested in `contracts/test/DeployGuards.t.sol`): USDC must be Arc's
`0x3600000000000000000000000000000000000000`; `ADMIN`, `TREASURY`, `RELAYER`, `BASE_URI`, `KOMA_BASE_URI` are
required; `ADMIN` must have code (a Safe; Safe v1.4.1 is deployed on Arc) unless `ALLOW_EOA_ADMIN=true`;
`ADMIN != deployer`, `RELAYER != ADMIN`; no localhost URIs; launch floors 1,000 USDC graduation target and 1 h
voting window (no demo series on mainnet).

## 1. Prepare

| Variable | Value |
|---|---|
| `ADMIN` | Safe that owns the protocol (roles, router, PoolManager). Create it at app.safe.global on Arc, or reuse one. |
| `TREASURY` | Address that receives KOMA's 40% fee share and the 5% graduation fee (can be the same Safe). |
| `RELAYER` | Address of the production server key (`SERVER_PRIVATE_KEY`). A **new** key, not the testnet one, not the deployer. |
| `KOMA_PUBLIC_URL` | The hosted app's origin, e.g. `https://koma.example` (token metadata URIs are derived from it). |
| `DEPLOYER_ENV` | File with `DEPLOYER_PRIVATE_KEY` (default `../.deployer/deployer.env`). |

Fund the deployer with **1.5 USDC** on Arc mainnet (the deploy spends ~0.7–0.85 USDC, see below; each transaction also needs headroom for forge's gas reservation, at most ~0.35 USDC for the PoolManager) and the relayer with **5–10 USDC** (its gas
float; see §5).

## 2. Simulate, then deploy

```bash
# Simulation against live Arc mainnet state: no broadcast, prints every address and the gas total
ADMIN=0x<safe> TREASURY=0x<treasury> RELAYER=0x<server> KOMA_PUBLIC_URL=https://<app> \
  DRY_RUN=1 sh scripts/deploy.sh mainnet

# The real thing (takes the shared deployer lock for the broadcast only)
ADMIN=0x<safe> TREASURY=0x<treasury> RELAYER=0x<server> KOMA_PUBLIC_URL=https://<app> \
  CONFIRM_MAINNET=yes VERIFY=1 sh scripts/deploy.sh mainnet
```

Output: `deployments/arc-mainnet.json`. `VERIFY=1` runs `scripts/verify.sh mainnet` (Blockscout at
explorer.arc.io). Commit the JSON; the app and the indexer read it.

### Gas (USDC)

| | Transactions | Gas used | USDC |
|---|---|---|---|
| Full deploy on a fork of Arc testnet (`scripts/local-fork.sh`, arc-anvil, base fee 20 gwei): 4 Tokenbound contracts + v4 + KOMA | 24 | 33,065,114 | 0.661 |
| Same, Tokenbound already present | 20 | 28,233,945 | 0.565 |
| Mainnet estimate (adds the ERC-6551 registry, ~0.3M gas) at 20–25 gwei | 25 | ~33.4M | **0.67–0.84** |
| Budget with margin (forge prices its pre-flight estimate at ~2.5× the base fee and +30% gas: ~2.3 USDC "required", but only ~0.85 is spent) | | | **1.5 USDC** |

Arc's base fee floor is 20 gwei and is paid in USDC (native 18-decimal units): 1M gas ≈ 0.02 USDC.

## 3. After the deploy

```bash
# roles: deployer holds none, ADMIN holds DEFAULT_ADMIN_ROLE, RELAYER the operational roles
F=deployments/arc-mainnet.json; R=https://rpc.mainnet.arc.io; get() { node -e "console.log(require('./$F').$1)"; }
cast call $(get seriesFactory) "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 <deployer> --rpc-url $R   # false
cast call $(get seriesFactory) "hasRole(bytes32,address)(bool)" $(cast keccak LAUNCHER_ROLE) $(get relayer) --rpc-url $R                                     # true
cast call $(get royaltyRouter) "owner()(address)" --rpc-url $R                                                                                                  # ADMIN
```

If `routerWired` is `false` in the JSON (only when `ADMIN` already owned the router), the Safe must send
`setFactory(<seriesFactory>)` on the router before the first launch.

## 4. Host the app (Vercel or Railway)

The app is one Next.js server with SQLite and on-disk art, so it needs **one instance with a persistent volume**
(Railway service with a volume, or any container host; `Dockerfile` included). A Vercel deployment works for the
pages but the pipeline, keeper and index need a long-running process: put Vercel in front of the server or host
the server alone.

| Env var | Mainnet value |
|---|---|
| `NEXT_PUBLIC_KOMA_NETWORK` | `arc` (build-time) |
| `NEXT_PUBLIC_ARC_RPC_URL` | optional: a keyed Arc RPC for browsers (default `https://rpc.mainnet.arc.io`) (build-time) |
| `KOMA_SERVER_RPC_URL` | optional: server-only Arc RPC |
| `SERVER_PRIVATE_KEY` | the `RELAYER` key (secret) |
| `KOMA_PAY_TO` | where comic and launch payments go (e.g. the treasury Safe); default = server key |
| `KOMA_PUBLIC_URL` | the app origin (same as at deploy time) |
| `KOMA_DATA_DIR` | the volume mount, e.g. `/data` |
| `FAL_KEY` (+ optional `MOONSHOT_API_KEY`, `HUNYUAN_API_KEY`) | AI providers (secret) |
| `KOMA_FAL_DAILY_USD` | daily AI spend cap, e.g. `25` |
| `ENVIO_GRAPHQL_URL` | optional: hosted Envio endpoint (else the built-in SQLite index) |

`deployments/arc-mainnet.json` must be in the image (the Dockerfile copies `deployments/`).

## 5. Services that must run

| Service | What | Required |
|---|---|---|
| The KOMA server (above) | x402 facilitator, AI pipeline, trade relayer, canon keeper (finalizes votes after each window, graduates complete curves), event index | yes |
| Relayer gas float | the server key pays gas for every settlement, relayed trade, launch (~5M gas ≈ 0.1 USDC) and mint. A $1 relayed buy costs ≈ 0.008 USDC of gas against 0.015 USDC of fee. Keep 5–10 USDC on it and alert under 2 (`/api/status` → `relayerUsdc`) | yes |
| Envio indexer (`indexer/`) | leaderboard aggregates; `npm run config:mainnet` then deploy to Envio's hosted service | optional |

## 6. Smoke test (smallest amounts, ~2.5 USDC)

1. `/api/status`: `ready: true`, `chainId: 5042`, launchpad addresses present, AI `ok`.
2. Buy a 1-page comic ($0.10) from a fresh wallet; the issue page links the payment and mint txs on explorer.arc.io.
3. Launch a series ($1); buy $1 of its coin gaslessly; sell it back.
4. As the character's owner, send its earnings to Base over CCTP (needs > ~0.06 USDC in the character wallet; tip it).
5. Watch `relayerUsdc` drop by cents, not dollars.

A full demo (one comic, one launch, a few trades, one CCTP withdrawal) costs about **2.5 USDC** in payments plus
**~0.3 USDC** of relayer gas, on top of the deploy (~0.85 USDC).
