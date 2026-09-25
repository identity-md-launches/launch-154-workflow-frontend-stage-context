#!/usr/bin/env node
// Copies the verified handoff into web/public so `vite dev` and `vite build` serve the same
// runtime deployment configuration the app loads (./imd-deployment.json and ./abi/*.json).
// The asset inventory is filled in after the build by scripts/manifest.mjs.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_DIR, loadHandoff, loadVerifiedAbis } from './lib.mjs';

const { deployment, network } = loadHandoff();
const abis = loadVerifiedAbis(deployment);
const publicDir = join(WEB_DIR, 'public');
mkdirSync(join(publicDir, 'abi'), { recursive: true });

for (const a of abis) {
  writeFileSync(join(publicDir, a.abiPath), JSON.stringify(a.abi, null, 2) + '\n');
}

const config = {
  version: 1,
  launchId: deployment.launchId,
  chainId: deployment.chainId,
  sourceCommit: deployment.sourceCommit,
  attestationHash: deployment.attestationHash,
  contracts: abis.map(({ name, address, abiHash, abiPath }) => ({ name, address, abiHash, abiPath })),
  assets: [],
  network: network.network,
};
writeFileSync(join(publicDir, 'imd-deployment.json'), JSON.stringify(config, null, 2) + '\n');

// Optional offline snapshot of the public APIs (see scripts/snapshot.mjs). Keep an empty marker
// out of the export when no snapshot has been captured.
const snapshot = join(publicDir, 'data', 'snapshot.json');
console.log(
  `synced ${abis.length} ABI(s) and imd-deployment.json for chain ${deployment.chainId}` +
    (existsSync(snapshot) ? ' (snapshot present)' : ' (no API snapshot)'),
);
