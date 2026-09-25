#!/usr/bin/env node
// Writes dist/imd-deployment.json after the static export: handoff identifiers, verified ABI
// bindings, the network block copied unchanged, and the SHA-256 of every other exported file.
// `--check` re-derives everything and fails if the committed manifest differs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, loadHandoff, loadVerifiedAbis, sha256Hex, walkFiles, canonicalKeccak } from './lib.mjs';

const MANIFEST = 'imd-deployment.json';
const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const EXPORT_BUDGET_BYTES = 24 * 1024 * 1024; // well under half of the checker's 64 MiB budget

const check = process.argv.includes('--check');
if (!existsSync(join(DIST_DIR, 'index.html'))) {
  console.error('dist/index.html missing: run `vite build` first');
  process.exit(1);
}

const { deployment, network } = loadHandoff();
const abis = loadVerifiedAbis(deployment);

// The exported ABI files must be byte-identical in content to the verified handoff ABIs.
for (const a of abis) {
  const exported = JSON.parse(readFileSync(join(DIST_DIR, a.abiPath), 'utf8'));
  const hash = canonicalKeccak(exported);
  if (hash !== a.abiHash) throw new Error(`exported ${a.abiPath} hash ${hash} != ${a.abiHash}`);
}

const files = walkFiles(DIST_DIR).filter((p) => p !== MANIFEST);
let total = 0;
const assets = files.map((path) => {
  const bytes = readFileSync(join(DIST_DIR, path));
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} exceeds 8 MiB`);
  total += bytes.length;
  return { path, sha256: sha256Hex(bytes) };
});
if (assets.length > MAX_ASSETS) throw new Error(`${assets.length} assets exceed the limit of ${MAX_ASSETS}`);
if (total > EXPORT_BUDGET_BYTES) throw new Error(`export is ${total} bytes, over the ${EXPORT_BUDGET_BYTES} budget`);
for (const required of ['index.html', ...abis.map((a) => a.abiPath)]) {
  if (!assets.some((a) => a.path === required)) throw new Error(`required asset ${required} missing`);
}

const manifest = {
  version: 1,
  launchId: deployment.launchId,
  chainId: deployment.chainId,
  sourceCommit: deployment.sourceCommit,
  attestationHash: deployment.attestationHash,
  contracts: abis.map(({ name, address, abiHash, abiPath }) => ({ name, address, abiHash, abiPath })),
  assets,
  network: network.network,
};
const text = JSON.stringify(manifest, null, 2) + '\n';
const target = join(DIST_DIR, MANIFEST);

if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== text) {
    console.error(`${MANIFEST} is stale: rerun \`npm run manifest\``);
    process.exit(1);
  }
  console.log(`manifest ok: ${assets.length} assets, ${total} bytes, ${abis.length} ABI(s) verified`);
} else {
  writeFileSync(target, text);
  console.log(`wrote dist/${MANIFEST}: ${assets.length} assets, ${total} bytes`);
}
