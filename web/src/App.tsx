import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { loadDeployment, type Deployment } from './lib/deployment';
import { useWallet } from './lib/useWallet';
import { useAsync } from './lib/useAsync';
import { WalletBar } from './components/WalletBar';
import { DeploymentPanel } from './components/DeploymentPanel';
import { Dashboard } from './components/Dashboard';
import { TokenActions } from './components/TokenActions';
import { SwapPanel } from './components/SwapPanel';

export interface ChainVerification {
  tokenCode: boolean;
  projectCode: boolean;
  chainId: number;
}

export function App() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDeployment()
      .then((d) => {
        if (!cancelled) setDeployment(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setDeployError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const wallet = useWallet(deployment);

  // Verify the configured RPC really is the manifest chain and that both addresses hold code
  // before any transaction control is enabled.
  const verifyFn = useMemo(() => {
    if (!deployment) return null;
    return async (): Promise<ChainVerification> => {
      const client = deployment.publicClient;
      const [chainId, tokenCode, projectCode] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: deployment.token.address as Address }),
        client.getCode({ address: deployment.project.address as Address }),
      ]);
      if (chainId !== deployment.manifest.chainId) {
        throw new Error(`RPC reports chain ${chainId}, expected ${deployment.manifest.chainId}`);
      }
      return { chainId, tokenCode: Boolean(tokenCode && tokenCode !== '0x'), projectCode: Boolean(projectCode && projectCode !== '0x') };
    };
  }, [deployment]);
  const verification = useAsync(verifyFn, [deployment]);

  const [linkedCount, setLinkedCount] = useState(0);
  const onLinkedCount = useCallback((n: number) => setLinkedCount(n), []);

  const abisVerified = deployment ? Object.values(deployment.contracts).every((c) => c.abiVerified) : false;
  const chainReady = Boolean(verification.data?.tokenCode && verification.data?.projectCode) && abisVerified;
  const txEnabled = chainReady && wallet.onTargetChain && wallet.walletClient !== null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◍
          </span>
          <div className="brand-text">
            <h1>Identity MD Seat Compute</h1>
            <p className="brand-sub">
              Per-seat inference dashboard and <span translate="no">COMPUTE</span> token on{' '}
              <span translate="no">{deployment?.network?.name ?? 'the launch chain'}</span>
            </p>
          </div>
        </div>
        <WalletBar wallet={wallet} deployment={deployment} linkedCount={linkedCount} />
      </header>

      <main id="main" className="layout" tabIndex={-1}>
        {deployError && (
          <section className="card error-card" role="alert">
            <h2>Deployment Configuration Failed to Load</h2>
            <p>{deployError}</p>
            <p>The app reads <code>imd-deployment.json</code> next to <code>index.html</code>. Rebuild the export and try again.</p>
          </section>
        )}

        <Dashboard account={wallet.account} onLinkedCount={onLinkedCount} deployment={deployment} />

        <DeploymentPanel deployment={deployment} verification={verification} />

        <section className="grid-2">
          <TokenActions deployment={deployment} wallet={wallet} txEnabled={txEnabled} chainReady={chainReady} verificationError={verification.error} />
          <SwapPanel deployment={deployment} wallet={wallet} txEnabled={txEnabled} chainReady={chainReady} />
        </section>
      </main>

      <footer className="footer">
        <p>
          Counters are plane-reported by api.imd.fun, not audited billing. Token balances grant no claim to compute or seats. Static
          site, no backend; wallet connection is not authentication.
        </p>
      </footer>
    </>
  );
}
