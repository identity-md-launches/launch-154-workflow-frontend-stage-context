import type { Abi, Address, Hex } from 'viem';
import { createPublicClient, fallback, http, isAddress, type PublicClient } from 'viem';
import { DEPLOYMENT_MANIFEST_PATH } from '../config';
import { canonicalKeccak } from './canonical';

export interface UniswapV4Addresses {
  poolManager: Address;
  universalRouter: Address;
  quoter: Address;
  stateView: Address;
  positionManager: Address;
  permit2: Address;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets?: string[];
  uniswapV4?: UniswapV4Addresses;
}

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network?: NetworkBlock;
}

export interface LoadedContract extends ManifestContract {
  abi: Abi;
  /** True when canonicalKeccak(abi) equals the manifest abiHash. */
  abiVerified: boolean;
}

export interface Deployment {
  manifest: DeploymentManifest;
  network: NetworkBlock | null;
  contracts: Record<string, LoadedContract>;
  token: LoadedContract;
  project: LoadedContract;
  chainIdHex: Hex;
  publicClient: PublicClient;
  /** wallet_addEthereumChain parameters derived from the network block. */
  walletAddChain: {
    chainId: Hex;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  } | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

function assertManifest(value: unknown): asserts value is DeploymentManifest {
  const m = value as Partial<DeploymentManifest>;
  if (!m || typeof m !== 'object') throw new Error('deployment manifest is not an object');
  if (m.version !== 1) throw new Error(`unsupported manifest version ${String(m.version)}`);
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0) {
    throw new Error('manifest chainId is invalid');
  }
  if (typeof m.launchId !== 'string' || !m.launchId) throw new Error('manifest launchId missing');
  if (typeof m.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.sourceCommit)) {
    throw new Error('manifest sourceCommit is not a 40-hex commit');
  }
  if (typeof m.attestationHash !== 'string' || !HEX64.test(m.attestationHash)) {
    throw new Error('manifest attestationHash is not 64 hex characters');
  }
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) throw new Error('manifest has no contracts');
  for (const c of m.contracts) {
    if (!c || typeof c.name !== 'string' || !isAddress(c.address)) throw new Error('manifest contract entry invalid');
    if (!HEX64.test(c.abiHash)) throw new Error(`abiHash for ${c.name} is not 64 hex characters`);
    if (typeof c.abiPath !== 'string' || c.abiPath.startsWith('/') || c.abiPath.includes('..') || /^[a-z]+:/i.test(c.abiPath)) {
      throw new Error(`abiPath for ${c.name} must be relative to the export root`);
    }
  }
  if (!Array.isArray(m.assets)) throw new Error('manifest assets missing');
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Resolve a path relative to the document (works under gateway subpaths and hash routing). */
export function resolveRelative(path: string, base?: string): string {
  const root = base ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
  return new URL(path, root).toString();
}

export function makePublicClient(network: NetworkBlock | null, chainId: number): PublicClient {
  const urls = network?.rpcUrls ?? [];
  const chain = {
    id: chainId,
    name: network?.name ?? `Chain ${chainId}`,
    nativeCurrency: network?.nativeCurrency ?? { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: urls } },
    blockExplorers: network?.explorer ? { default: { name: 'Explorer', url: network.explorer } } : undefined,
  };
  const transport = urls.length
    ? fallback(urls.map((u) => http(u, { timeout: 15_000, retryCount: 1 })), { rank: false })
    : http();
  return createPublicClient({ chain, transport, pollingInterval: 2_000 });
}

export interface LoadOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  manifestPath?: string;
}

/**
 * Load ./imd-deployment.json and every referenced ABI. This is the single runtime source of
 * addresses, chain id, public RPC URLs and Uniswap v4 addresses.
 */
export async function loadDeployment(opts: LoadOptions = {}): Promise<Deployment> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const manifestUrl = resolveRelative(opts.manifestPath ?? DEPLOYMENT_MANIFEST_PATH, opts.baseUrl);
  const raw = await fetchJson(manifestUrl, fetchImpl);
  assertManifest(raw);
  const manifest = raw;
  const network = manifest.network && manifest.network.chainId === manifest.chainId ? manifest.network : null;
  if (manifest.network && !network) {
    throw new Error(`network block chainId ${manifest.network.chainId} differs from manifest chainId ${manifest.chainId}`);
  }

  const contracts: Record<string, LoadedContract> = {};
  for (const c of manifest.contracts) {
    const abi = (await fetchJson(resolveRelative(c.abiPath, opts.baseUrl), fetchImpl)) as Abi;
    if (!Array.isArray(abi)) throw new Error(`${c.abiPath} is not an ABI array`);
    const abiVerified = canonicalKeccak(abi) === c.abiHash;
    contracts[c.name] = { ...c, address: c.address.toLowerCase() as Address, abi, abiVerified };
  }

  const token = contracts['SeatCompute'] ?? findByAbi(contracts, 'totalSupply');
  const project = contracts['ComputeProject'] ?? findByAbi(contracts, 'siteLabel');
  if (!token) throw new Error('manifest has no ERC-20 token contract');
  if (!project) throw new Error('manifest has no ComputeProject contract');

  const chainIdHex = `0x${manifest.chainId.toString(16)}` as Hex;
  const walletAddChain = network
    ? {
        chainId: chainIdHex,
        chainName: network.name,
        rpcUrls: network.rpcUrls,
        nativeCurrency: network.nativeCurrency,
        blockExplorerUrls: [network.explorer],
      }
    : null;

  return {
    manifest,
    network,
    contracts,
    token,
    project,
    chainIdHex,
    publicClient: makePublicClient(network, manifest.chainId),
    walletAddChain,
  };
}

function findByAbi(contracts: Record<string, LoadedContract>, fn: string): LoadedContract | undefined {
  return Object.values(contracts).find((c) => c.abi.some((item) => item.type === 'function' && item.name === fn));
}

export function explorerAddress(network: NetworkBlock | null, address: string): string | null {
  return network ? `${network.explorer.replace(/\/$/, '')}/address/${address}` : null;
}

export function explorerTx(network: NetworkBlock | null, hash: string): string | null {
  return network ? `${network.explorer.replace(/\/$/, '')}/tx/${hash}` : null;
}
