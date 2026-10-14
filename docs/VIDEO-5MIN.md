# Five-minute Arc mainnet film

Run `node scripts/e2e-browser-video-koma-5min.mjs` from this repository. This read-only audit checks successful receipts, exact gas fees and blocks, hosted landing page, and explorer logs; it never repeats payments.

Artifacts live in the shared Arc workspace at `../video/out/koma-5min.mp4`, `koma-5min.json`, `koma-5min-script.json`, and `koma-5min-REVIEW.md`. Binaries remain outside git.

- Output: koma-5min.mp4, timeline JSON, script JSON; 300 seconds, 1920×1080, 30 fps.
- Post-render check 2026-10-14T19:41:42.540Z: 11/11 successful mainnet receipts; exact fees; hosted landing/explorer pass.
- Narration: 682 timed words; no voice generated or paid API called. Captions + quiet instrumental bed.
- Live: x402 402 → 200, 0.10 USDC settlement, issue NFT #2 minted to reader; content commitment and payment-to-token mapping verified.
- Existing AI artwork reused from the testnet archive. Fresh AI generation Not run. Saved issue metadata hash includes image URLs, not on-chain image bytes.
- Issuance used an on-demand archived-art adapter with the real x402 library; series launch and 1.10 USDC buy used the recording runner.
- Browser: comic reader, series, signed canon vote, full gasless permit/sell, character earnings withdrawal, and shelf captured.
- One controlled wallet plays creator, reader and voter roles. This is not evidence of independent customer adoption or a decentralized electorate.
- Real one-hour canon window ended 2026-10-14 19:37:40 UTC; keeper finalized issue #2: 0x81ed4ed622672d421544244b307318977a4b274f6fc2888612384e89c616a073.
- Canon vote is an off-chain signature; proposal and finalized vote-root commitment are on chain. Snapshot weight survives the later sale.
- Local SQLite service, indexer and keeper ran against the same mainnet contracts; no paid hosting resources created.
- Fixed testnet-only trade journal guard: preserve configured mainnet/testnet chain, reject cross-network recovery. Typecheck, 37 tests, production build passed.
- Proof card lists successful product receipts; JSON also includes demo funding and cleanup. Reader swept to deployer; conservative dust remains.
- Visual contact sheet inspected; explorer overview/log drops, split roles, architecture, proof and end cards included.
- Weak: durable hosted storage/keeper availability. V4 graduation, CCTP transfer, and fresh AI generation Not run in this film.

The signed canon vote was recovered to the expected voter and its canonical serialized root matched the finalized event. Private draft/passkey flow was shown as Not run.
