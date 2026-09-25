// Shared helpers for the handoff sync and manifest scripts (Node, no dependencies beyond viem).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToBytes } from 'viem';

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = join(WEB_DIR, '..');
export const DIST_DIR = join(REPO_DIR, 'dist');
export const HANDOFF_DIR = join(WEB_DIR, 'handoff');
export const ABI_SOURCE_DIR = join(REPO_DIR, 'docs', 'abi');

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Keccak-256 of the canonical JSON encoding, as 64 lowercase hex chars without 0x. */
export function canonicalKeccak(value) {
  return keccak256(stringToBytes(canonicalJson(value))).slice(2);
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadHandoff() {
  const deployment = readJson(join(HANDOFF_DIR, 'deployment.json'));
  const network = readJson(join(HANDOFF_DIR, 'network.json'));
  if (deployment.version !== 1) throw new Error(`unexpected handoff version ${deployment.version}`);
  if (network.network.chainId !== deployment.chainId) {
    throw new Error(`network chainId ${network.network.chainId} != deployment chainId ${deployment.chainId}`);
  }
  return { deployment, network };
}

/** Read each ABI export at docs/abi/<Name>.json and verify canonicalKeccak against the handoff. */
export function loadVerifiedAbis(deployment) {
  return deployment.contracts.map((c) => {
    const path = join(ABI_SOURCE_DIR, `${c.name}.json`);
    const abi = readJson(path);
    if (!Array.isArray(abi)) throw new Error(`${path} is not an ABI array`);
    const hash = canonicalKeccak(abi);
    if (hash !== c.abiHash) {
      throw new Error(`ABI hash mismatch for ${c.name}: computed ${hash}, handoff ${c.abiHash}`);
    }
    return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json`, abi };
  });
}

export function walkFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  };
  visit(root);
  return out.sort();
}
