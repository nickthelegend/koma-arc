// Records on-chain proof (tx hashes from the e2e suites) into deployments/arc-<network>.json under "proof".
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function recordProof(suite, data, file = process.env.KOMA_DEPLOYMENT_FILE ?? "deployments/arc-testnet.json") {
  if (!existsSync(file)) return;
  const d = JSON.parse(readFileSync(file, "utf8"));
  d.proof = { ...(d.proof ?? {}), [suite]: { ...(d.proof?.[suite] ?? {}), ...data, at: new Date().toISOString() } };
  writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
  console.log(`proof recorded in ${file} → proof.${suite}`);
}
