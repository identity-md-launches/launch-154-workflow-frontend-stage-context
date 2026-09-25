import type { Address, Hex } from 'viem';
import { getAddress } from 'viem';

/** Minimal EIP-1193 provider surface used by the app. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
  isMetaMask?: boolean;
}

/** EIP-6963 announced provider. */
export interface WalletOption {
  id: string; // rdns or 'injected'
  name: string;
  icon: string | null;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<Eip6963Detail>;
  }
}

/** Discover wallets via EIP-6963, with window.ethereum as a fallback. Resolves after a short window. */
export function discoverWallets(win: Window = window, waitMs = 150): Promise<WalletOption[]> {
  return new Promise((resolve) => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (event: CustomEvent<Eip6963Detail>) => {
      const { info, provider } = event.detail ?? ({} as Eip6963Detail);
      if (!info || !provider) return;
      found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon || null, provider });
    };
    win.addEventListener('eip6963:announceProvider', onAnnounce);
    try {
      win.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch {
      // ignore
    }
    setTimeout(() => {
      win.removeEventListener('eip6963:announceProvider', onAnnounce);
      if (found.size === 0 && win.ethereum) {
        found.set('injected', {
          id: 'injected',
          name: win.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet',
          icon: null,
          provider: win.ethereum,
        });
      }
      resolve(Array.from(found.values()));
    }, waitMs);
  });
}

export function parseChainId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string') {
    const n = value.startsWith('0x') ? parseInt(value, 16) : Number(value);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

export function normalizeAccounts(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  const out: Address[] = [];
  for (const a of value) {
    if (typeof a !== 'string') continue;
    try {
      out.push(getAddress(a));
    } catch {
      // skip malformed
    }
  }
  return out;
}

export interface AddChainParams {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

function isUnknownChainError(err: unknown): boolean {
  const e = err as { code?: number; data?: { originalError?: { code?: number } }; message?: string };
  if (e?.code === 4902 || e?.data?.originalError?.code === 4902) return true;
  const msg = String(e?.message ?? '').toLowerCase();
  return msg.includes('unrecognized chain') || msg.includes('unknown chain') || msg.includes('4902') || msg.includes('not been added');
}

/**
 * Switch the wallet to the target chain. If the wallet does not know the chain (4902 or an
 * equivalent message) add it with wallet_addEthereumChain, then switch again.
 * Returns which path was taken so the UI can describe it.
 */
export async function switchOrAddChain(
  provider: Eip1193Provider,
  chainIdHex: Hex,
  addParams: AddChainParams | null,
): Promise<'switched' | 'added'> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    return 'switched';
  } catch (err) {
    if (!isUnknownChainError(err) || !addParams) throw err;
    await provider.request({ method: 'wallet_addEthereumChain', params: [addParams] });
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    } catch (second) {
      // Some wallets switch as part of add; verify before surfacing the error.
      const current = parseChainId(await provider.request({ method: 'eth_chainId' }));
      if (current !== parseInt(chainIdHex, 16)) throw second;
    }
    return 'added';
  }
}
