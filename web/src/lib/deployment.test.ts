import { describe, expect, it } from 'vitest';
import { loadDeployment, resolveRelative } from './deployment';
import { canonicalKeccak } from './canonical';
import { ABIS, MANIFEST, TOKEN, PROJECT, manifestRoutes, mockFetch } from '../test/fixtures';

describe('loadDeployment', () => {
  it('loads the manifest and ABIs relative to the document and verifies ABI hashes', async () => {
    const d = await loadDeployment({ fetchImpl: mockFetch(manifestRoutes()), baseUrl: 'https://gateway.example/ipfs/QmX/' });
    expect(d.manifest.chainId).toBe(11155111);
    expect(d.token.address).toBe(TOKEN.address.toLowerCase());
    expect(d.project.address).toBe(PROJECT.address.toLowerCase());
    expect(d.token.abiVerified).toBe(true);
    expect(d.project.abiVerified).toBe(true);
    expect(d.network?.uniswapV4?.universalRouter).toBe(MANIFEST.network!.uniswapV4!.universalRouter);
    expect(d.chainIdHex).toBe('0xaa36a7');
    expect(d.walletAddChain).toEqual({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: MANIFEST.network!.rpcUrls,
      nativeCurrency: MANIFEST.network!.nativeCurrency,
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    });
  });

  it('flags an ABI whose hash differs from the manifest', async () => {
    const tampered = { ...manifestRoutes(), 'abi/SeatCompute.json': [...(ABIS['abi/SeatCompute.json'] as unknown[]), { type: 'fallback', stateMutability: 'payable' }] };
    const d = await loadDeployment({ fetchImpl: mockFetch(tampered), baseUrl: 'http://localhost/' });
    expect(d.token.abiVerified).toBe(false);
  });

  it('rejects manifests with the wrong version, traversal paths or mismatched network', async () => {
    await expect(loadDeployment({ fetchImpl: mockFetch({ ...manifestRoutes(), 'imd-deployment.json': { ...MANIFEST, version: 2 } }), baseUrl: 'http://localhost/' })).rejects.toThrow(/version/);
    await expect(
      loadDeployment({
        fetchImpl: mockFetch({ ...manifestRoutes(), 'imd-deployment.json': { ...MANIFEST, contracts: [{ ...MANIFEST.contracts[0], abiPath: '../abi/x.json' }] } }),
        baseUrl: 'http://localhost/',
      }),
    ).rejects.toThrow(/relative/);
    await expect(
      loadDeployment({ fetchImpl: mockFetch({ ...manifestRoutes(), 'imd-deployment.json': { ...MANIFEST, network: { ...MANIFEST.network, chainId: 1 } } }), baseUrl: 'http://localhost/' }),
    ).rejects.toThrow(/differs/);
  });

  it('resolves relative paths against a gateway subpath', () => {
    expect(resolveRelative('./abi/X.json', 'https://gw.example/ipfs/QmX/index.html')).toBe('https://gw.example/ipfs/QmX/abi/X.json');
    expect(resolveRelative('./imd-deployment.json', 'https://name.eth.limo/#/?q=1')).toBe('https://name.eth.limo/imd-deployment.json');
  });
});

describe('canonicalKeccak', () => {
  it('matches the handoff hashes for both ABI exports', () => {
    expect(canonicalKeccak(ABIS['abi/SeatCompute.json'])).toBe(TOKEN.abiHash);
    expect(canonicalKeccak(ABIS['abi/ComputeProject.json'])).toBe(PROJECT.abiHash);
  });

  it('is key-order independent', () => {
    expect(canonicalKeccak({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalKeccak({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});
