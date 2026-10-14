# Hosted Arc testnet

Live: https://app-production-758c.up.railway.app (Arc testnet)

Railway project `koma-arc-testnet`, service `app`, one instance with a persistent volume mounted at `/data`. This single Next.js server owns the UI, API, x402 facilitator, trade relayer, canon keeper, SQLite event index and artwork. No separate database or Envio service is needed. API calls are same-origin.

The image builds with `NEXT_PUBLIC_KOMA_NETWORK=arc-testnet`; runtime reads `/app/deployments/arc-testnet.json`. Server and browser RPCs point at Arc testnet. `SERVER_PRIVATE_KEY` and the existing fal credential are Railway secrets sourced from the gitignored environment. The AI daily cap is $5. Gateway and CCIP remain disabled. Source uploads exclude env files, keys, local state, dependencies and generated output.

Deploy from the repo root with `railway up --service app`. `/api/health` checks process liveness; `/api/status` separately reports testnet, funded relayer and AI readiness. The SQLite index uses 5,000-block RPC chunks and polls every ten seconds. A fresh deployment indexes existing live events into its own database; source `.data` is never uploaded.

Hosted HTTP responses, browser screenshots, console results and any real-action receipt are under `docs/screens/hosted/`. `scripts/hosted-smoke.mjs` caps its single one-page comic payment at 0.10 testnet USDC and saves the job ID before polling, so rerunning it resumes the same job.

Limitations: prior Envio, graduation and cross-chain claims retain their existing Live/Fork/Not run labels. Writers' Room passkey creation requires user interaction and was not exercised with a personal authenticator. AI generation depends on the existing fal account's access and balance; readiness and the real-job result are recorded separately.

The primary Circle RPC throttled the Railway server during initial smoke checks. Server reads, signing submissions and indexing now use the [official Blockdaemon testnet endpoint](https://docs.arc.io/arc/references/rpc-endpoints), verified to return chain 5042002. Browsers use the same-origin RPC proxy. No payment was taken during the initial failed readiness attempt.

Verified 2026-10-14: Railway deployment `52bb69a7-ec5f-4f7f-b966-40e4aec04f43` SUCCESS; all navigation routes and readiness endpoints HTTP 200; browser console clean; existing live series/trades visible. [Moonlight Delivery](https://app-production-758c.up.railway.app/c/faa17aaf5d) completed with real AI art and minted token #3. Payment plus settlement/mint gas totaled 0.10822920 testnet USDC. Payment `0x7ebc3f6b28ec100a005e26852f19975696052705ece903487f22692c68cb8379`; mint `0x975c374b5a5ffb8dc328f3e7295af0d9c3e047f6ccf79a14c6b0e74aa947f4f8`.
