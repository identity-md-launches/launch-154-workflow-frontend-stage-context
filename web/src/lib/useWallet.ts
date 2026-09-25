import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { createWalletClient, custom, type WalletClient } from 'viem';
import type { Deployment } from './deployment';
import { discoverWallets, normalizeAccounts, parseChainId, switchOrAddChain, type Eip1193Provider, type WalletOption } from './wallet';
import { errorMessage } from './format';

export type WalletStatus = 'idle' | 'discovering' | 'connecting' | 'connected';

export interface WalletState {
  status: WalletStatus;
  options: WalletOption[];
  selected: WalletOption | null;
  account: Address | null;
  chainId: number | null;
  error: string | null;
  switching: boolean;
  /** True when the wallet is connected and on the deployment chain. */
  onTargetChain: boolean;
  walletClient: WalletClient | null;
  connect: (option?: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  refreshWallets: () => Promise<void>;
}

export function useWallet(deployment: Deployment | null): WalletState {
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const listeners = useRef<{ provider: Eip1193Provider; off: () => void } | null>(null);

  const refreshWallets = useCallback(async () => {
    setStatus((s) => (s === 'connected' ? s : 'discovering'));
    const found = await discoverWallets();
    setOptions(found);
    setStatus((s) => (s === 'connected' ? s : 'idle'));
  }, []);

  useEffect(() => {
    void refreshWallets();
  }, [refreshWallets]);

  const detach = useCallback(() => {
    listeners.current?.off();
    listeners.current = null;
  }, []);

  const attach = useCallback(
    (provider: Eip1193Provider) => {
      detach();
      const onAccounts = (accs: unknown) => {
        const list = normalizeAccounts(accs);
        if (list.length === 0) {
          setAccount(null);
          setStatus('idle');
        } else {
          setAccount(list[0] ?? null);
        }
      };
      const onChain = (id: unknown) => setChainId(parseChainId(id));
      const onDisconnect = () => {
        setAccount(null);
        setStatus('idle');
      };
      provider.on?.('accountsChanged', onAccounts as never);
      provider.on?.('chainChanged', onChain as never);
      provider.on?.('disconnect', onDisconnect as never);
      listeners.current = {
        provider,
        off: () => {
          provider.removeListener?.('accountsChanged', onAccounts as never);
          provider.removeListener?.('chainChanged', onChain as never);
          provider.removeListener?.('disconnect', onDisconnect as never);
        },
      };
    },
    [detach],
  );

  useEffect(() => detach, [detach]);

  const connect = useCallback(
    async (option?: WalletOption) => {
      setError(null);
      const pick = option ?? selected ?? options[0] ?? null;
      if (!pick) {
        setError('No browser wallet detected. Install MetaMask or another EIP-1193 wallet, then reload.');
        return;
      }
      setSelected(pick);
      setStatus('connecting');
      try {
        const accs = normalizeAccounts(await pick.provider.request({ method: 'eth_requestAccounts' }));
        if (accs.length === 0) throw new Error('The wallet returned no accounts.');
        const id = parseChainId(await pick.provider.request({ method: 'eth_chainId' }));
        attach(pick.provider);
        setAccount(accs[0] ?? null);
        setChainId(id);
        setStatus('connected');
      } catch (err) {
        setStatus('idle');
        setError(errorMessage(err));
      }
    },
    [attach, options, selected],
  );

  const disconnect = useCallback(() => {
    detach();
    setAccount(null);
    setChainId(null);
    setStatus('idle');
    setError(null);
  }, [detach]);

  const switchChain = useCallback(async () => {
    if (!selected || !deployment) return;
    setSwitching(true);
    setError(null);
    try {
      await switchOrAddChain(selected.provider, deployment.chainIdHex, deployment.walletAddChain);
      const id = parseChainId(await selected.provider.request({ method: 'eth_chainId' }));
      setChainId(id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }, [selected, deployment]);

  const onTargetChain = status === 'connected' && deployment !== null && chainId === deployment.manifest.chainId;

  const walletClient = useMemo(() => {
    if (!selected || !account || !deployment || !onTargetChain) return null;
    return createWalletClient({
      account,
      chain: deployment.publicClient.chain,
      transport: custom(selected.provider),
    });
  }, [selected, account, deployment, onTargetChain]);

  return {
    status,
    options,
    selected,
    account,
    chainId,
    error,
    switching,
    onTargetChain,
    walletClient,
    connect,
    disconnect,
    switchChain,
    refreshWallets,
  };
}
