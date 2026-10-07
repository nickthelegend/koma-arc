// Prints the README address table from a deployments file and writes it between the README's address markers.
//   node scripts/addresses-md.mjs [deployments/arc-testnet.json]
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "deployments/arc-testnet.json";
const d = JSON.parse(readFileSync(file, "utf8"));
const explorer = d.chainId === 5042 ? "https://explorer.arc.io" : "https://explorer.testnet.arc.io";
const rows = [
  ["KomaIssues (ERC-721 issues)", d.komaIssues],
  ["SeriesFactory", d.seriesFactory],
  ["CharacterNFT", d.characterNft],
  ["CanonRegistry", d.canonRegistry],
  ["Graduator (v4 hook)", d.graduator],
  ["KomaSwapper", d.swapper],
  ["CurveMath", d.curveMath],
  ["RoyaltyRouter", d.royaltyRouter],
  ["Uniswap v4 PoolManager (deployed by KOMA)", d.poolManager],
  ["Uniswap v4 PositionManager", d.positionManager],
  ["Uniswap v4 V4Quoter", d.v4Quoter],
  ["ERC-6551 registry (canonical)", d.erc6551Registry],
  ["Tokenbound AccountProxy / AccountV3", `${d.accountProxy}`],
  ["USDC (Arc)", d.usdc],
  ["Relayer / facilitator (server key)", d.relayer],
];
const link = (a) => `[\`${a}\`](${explorer}/address/${a})`;
let md = `| Contract | Address |\n|---|---|\n${rows.map(([n, a]) => `| ${n} | ${link(a)} |`).join("\n")}\n`;
md += `\nDeployed from block ${d.deployBlock}${d.deployGas ? ` in ${d.deployGas.transactions} transactions, ${Number(d.deployGas.gasUsed).toLocaleString("en-US")} gas = ${d.deployGas.usdc} USDC` : ""}.\n`;
const p = d.proof ?? {};
const tx = (h) => `[\`${h.slice(0, 10)}…\`](${explorer}/tx/${h})`;
const proofs = [
  p.x402?.comic && ["x402 payment for a comic (EIP-3009, settled by KOMA's facilitator)", p.x402.comic.x402PaymentTx],
  p.x402?.comic && ["Issue minted to the payer", p.x402.comic.mintTx],
  p.launchpad?.launch?.launchTx && ["Series launch (NFT + ERC-6551 wallet + coin + curve, one tx)", p.launchpad.launch.launchTx],
  p.launchpad?.gaslessBuy && ["Gasless buy (relayed receiveWithAuthorization)", p.launchpad.gaslessBuy],
  p.launchpad?.gaslessSell && ["Gasless sell (permit + signed intent)", p.launchpad.gaslessSell],
  p.launchpad?.poolSwap && ["Gasless buy through the graduated Uniswap v4 pool", p.launchpad.poolSwap],
  p.launchpad?.cctp?.burnTx && ["Character wallet → CCTP burn on Arc (executeBatch)", p.launchpad.cctp.burnTx],
].filter(Boolean);
if (proofs.length) md += `\nProof transactions:\n\n${proofs.map(([n, h]) => `- ${n}: ${tx(h)}`).join("\n")}\n`;
if (p.launchpad?.cctp?.forwardTxHash) md += `- …minted on Base Sepolia by Circle's Forwarding Service: [\`${p.launchpad.cctp.forwardTxHash.slice(0, 10)}…\`](https://sepolia.basescan.org/tx/${p.launchpad.cctp.forwardTxHash})\n`;
const readme = readFileSync("README.md", "utf8");
const out = readme.replace(/<!-- addresses:start -->[\s\S]*<!-- addresses:end -->/, `<!-- addresses:start -->\n${md}<!-- addresses:end -->`);
writeFileSync("README.md", out);
console.log(md);
