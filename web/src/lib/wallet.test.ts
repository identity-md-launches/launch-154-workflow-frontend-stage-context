import { describe, expect, it } from 'vitest';
import { normalizeAccounts, parseChainId, switchOrAddChain, discoverWallets } from './wallet';
import { createMockProvider, ACCOUNT } from '../test/fixtures';

const addParams = {
  chainId: '0xaa36a7' as const,
  chainName: 'Sepolia',
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

describe('switchOrAddChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const p = createMockProvider({ chainId: 1, knownChains: [1, 11155111] });
    await expect(switchOrAddChain(p, '0xaa36a7', addParams)).resolves.toBe('switched');
    expect(p.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain']);
    expect(await p.request({ method: 'eth_chainId' })).toBe('0xaa36a7');
  });

  it('adds the chain with the walletAddChain parameters after a 4902, then switches', async () => {
    const p = createMockProvider({ chainId: 1, knownChains: [1] });
    await expect(switchOrAddChain(p, '0xaa36a7', addParams)).resolves.toBe('added');
    expect(p.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(p.calls[1]!.params[0]).toEqual(addParams);
    expect(await p.request({ method: 'eth_chainId' })).toBe('0xaa36a7');
  });

  it('propagates other errors (e.g. user rejection) without adding', async () => {
    const p = createMockProvider({ chainId: 1, knownChains: [1, 11155111] });
    const original = p.request.bind(p);
    p.request = async (args) => {
      if (args.method === 'wallet_switchEthereumChain') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      return original(args);
    };
    await expect(switchOrAddChain(p, '0xaa36a7', addParams)).rejects.toMatchObject({ code: 4001 });
  });
});

describe('helpers', () => {
  it('parses chain ids from hex and decimal', () => {
    expect(parseChainId('0xaa36a7')).toBe(11155111);
    expect(parseChainId(11155111)).toBe(11155111);
    expect(parseChainId('11155111')).toBe(11155111);
    expect(parseChainId('nope')).toBeNull();
  });

  it('normalises accounts to checksum form and drops junk', () => {
    expect(normalizeAccounts([ACCOUNT.toLowerCase(), 'x', 5])).toEqual([ACCOUNT]);
  });

  it('discovers EIP-6963 providers and falls back to window.ethereum', async () => {
    const p = createMockProvider();
    const win = window as Window & { ethereum?: unknown };
    win.ethereum = p;
    const fallback = await discoverWallets(window, 10);
    expect(fallback.map((o) => o.id)).toEqual(['injected']);

    const announced = createMockProvider();
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'u', name: 'Test Wallet', icon: '', rdns: 'test.wallet' }, provider: announced } }));
    });
    const found = await discoverWallets(window, 10);
    expect(found.map((o) => o.id)).toEqual(['test.wallet']);
    delete win.ethereum;
  });
});
