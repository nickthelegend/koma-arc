# KOMA — Vercel / Live testnet

LEAD: RUN THESE
```sh
node scripts/e2e-browser-hosted.mjs
node scripts/prepare-hosted-index.mjs
npm run typecheck
npm run test:unit
```

Frontend and read APIs: https://koma-arc.vercel.app. Next.js deploys from the repo root.
Addresses are pinned to deployments/arc-testnet.json (5042002). The catalogue cache contains only public chain events, rebuilt from testnet by prepare-hosted-index and refreshed on demand in Vercel functions. SQLite in /tmp is a disposable read cache; no user data is stored there on the hosted build. There is no background indexer or keeper in Vercel.

Browse real series, current testnet blocks and receipts; choose a comic prompt/style in the form. Hosted generation, paid minting, relayed trading, voting and encrypted draft persistence are disabled before payment. Historical artwork remains on the operator machine, so an empty comic shelf is not presented as the full chain inventory.
The live series listing can refresh without a daemon. The full studio pipeline cannot be replaced by cron alone: it uses in-memory x402 settlement callbacks, SQLite journals and local artwork across multi-step AI jobs. A durable queue, atomic shared journal and managed artwork storage are prerequisites for serverless generation. Minimum local demo: one Node 24 process (~1 GiB RAM) with persistent disk and existing AI credentials. Run npm run dev on the existing assigned port 4310. No paid resource was created.

Env (all nonsecret): NEXT_PUBLIC_KOMA_NETWORK=arc-testnet, KOMA_HOSTED_READ_ONLY=1, KOMA_SERVER_RPC_URL=https://rpc.blockdaemon.testnet.arc.io, KOMA_PUBLIC_URL=https://koma-arc.vercel.app, KOMA_DATA_DIR=/tmp/koma-cache. No signing or AI key is uploaded. Blockdaemon is listed in the official Arc RPC documentation: https://docs.arc.io/arc/references/rpc-endpoints.
Deploy: vercel link --project koma-arc, then vercel deploy --prod --yes. .vercelignore excludes credentials, local jobs/art, contract artifacts and screenshots. The read cache seed is public chain data only.
Production screenshots and assertions are under docs/screens/hosted/. No transaction was sent in this hosting pass. Generation, hosted settlement and cross-chain execution: Not run.

Verified: 12/12 production routes HTTP 200, no console errors/broken images, mobile fits 390 px. Story starter selection, status/series/board APIs, live factory bytecode and pre-payment mutation refusal pass. Typecheck and 32 unit tests pass; seed hydration and live refresh pass locally.
