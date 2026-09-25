/**
 * Central configuration.
 *
 * Deployment facts (chain id, contract addresses, ABI paths, public RPC URLs, Uniswap v4
 * addresses) are NOT duplicated here: they are read at runtime from ./imd-deployment.json,
 * the same manifest the publisher verifies against the attested handoff. See lib/deployment.ts.
 *
 * Everything below is public, non-deployment configuration.
 */

/** Public dashboard APIs (read-only). */
export const API = {
  contributors: 'https://api.imd.fun/contributors',
  workers: 'https://api.imd.fun/workers',
  /** Bundled fallback captured at build time (relative to the export root); may be absent. */
  snapshot: './data/snapshot.json',
  /** Abort a fetch after this long. */
  timeoutMs: 20_000,
} as const;

/** A worker counts as online when its last heartbeat is newer than this. */
export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Optional, read-only mainnet lookup used only when a contributor row has no wallet.
 * It never gates the UI and is not the launch chain.
 */
export const MAINNET_SEAT_LOOKUP = {
  chainId: 1,
  collection: '0x0000ec93127baa929e58e97dd0095a2bfb38ec1d',
  rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
  maxLookups: 25,
} as const;

/** Runtime path of the deployment manifest, relative to index.html. */
export const DEPLOYMENT_MANIFEST_PATH = './imd-deployment.json';

/**
 * Optional WalletConnect Cloud project id. Not supplied for this deployment, so the app offers
 * injected (EIP-6963 / window.ethereum) browser wallets only. Set VITE_WALLETCONNECT_PROJECT_ID
 * at build time if a WalletConnect connector is added later; the value is public.
 */
export const WALLETCONNECT_PROJECT_ID: string | undefined =
  (import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) || undefined;

/** Swap defaults (user adjustable in the UI). */
export const SWAP_DEFAULTS = {
  slippageBps: 100, // 1.00 %
  deadlineSeconds: 20 * 60,
  permit2ExpirationSeconds: 30 * 24 * 60 * 60,
} as const;
