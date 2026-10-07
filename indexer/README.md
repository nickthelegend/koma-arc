# KOMA indexer (Envio HyperIndex)

Indexes KOMA on Arc into aggregates the app's `/series` leaderboard reads over GraphQL:

| Entity | What |
| --- | --- |
| `Series` | launch data, curve state (raised, price, complete, graduated, v4 pool), volume, buys/sells, fee split (character / ancestors / treasury / graduation fee), holders, proposals, canon episodes |
| `Trade` | every curve trade and v4 pool swap (`venue`) |
| `Holder` | per-series balances from coin transfers; contract-held balances (curve, vesting, burn, Graduator, PoolManager, PositionManager) are kept but not counted |
| `Backer` | the leaderboard: volume and trades per address across all series |
| `SeriesDay` | daily volume and close price per series |
| `Proposal`, `CanonEpisode` | canon rounds: proposals, window, winner, votes root and tallies |
| `Comic` | minted issues (KomaIssues) |
| `Stats` | global totals |

Curves and coins are registered dynamically from `SeriesFactory.SeriesLaunched`.

## Run locally (against Arc testnet)

Needs Node 22 (Envio 3.12 doesn't support newer) and Docker. Envio lists Arc and Arc Testnet among its
HyperSync networks; by default this indexer syncs from Arc's public RPC, so no Envio token is needed.

```sh
npm install
npm run config:testnet    # config.yaml + src/deployment.ts from ../deployments/arc-testnet.json
npm run codegen
npm run db:up             # Postgres koma-envio-pg :55443 + Hasura koma-envio-hasura :8093 (own network and volume)
npm run dev               # envio start -r (re-index from the deploy block); `npm start` resumes
```

GraphQL: `http://localhost:8093/v1/graphql`. Point the app at it with `ENVIO_GRAPHQL_URL`; without it (or while the
indexer is down or backfilling) the board falls back to KOMA's own SQLite event cache. `npm run db:down` stops
only the `koma-envio-*` containers. `envio dev` isn't used because it creates fixed-name `envio-postgres` /
`envio-hasura` containers that other projects on the same machine may own.

End to end: `npm run test:envio` in the app (parity with the chain and the app's index, a live trade indexed, board
served from Envio).

## Mainnet

`npm run config:mainnet` reads `../deployments/arc-mainnet.json`. `ENVIO_HYPERSYNC=1 npm run config:mainnet` syncs
over Envio's HyperSync for Arc instead of the RPC (needs `ENVIO_API_TOKEN`). Hosted: deploy this folder to Envio's
hosted service and set `ENVIO_GRAPHQL_URL` in the app (see `../MAINNET.md`). The indexer is optional: without it
the app's own SQLite index serves the board.
