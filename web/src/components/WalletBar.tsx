import { useState } from 'react';
import type { Deployment } from '../lib/deployment';
import type { WalletState } from '../lib/useWallet';
import { shortAddress } from '../lib/format';

interface Props {
  wallet: WalletState;
  deployment: Deployment | null;
  linkedCount: number;
}

export function WalletBar({ wallet, deployment, linkedCount }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const chainName = deployment?.network?.name ?? (deployment ? `chain ${deployment.manifest.chainId}` : 'the launch chain');
  const connected = wallet.status === 'connected' && wallet.account;

  return (
    <div className="walletbar">
      {connected && (
        <span className="chip chip-linked" aria-live="polite" data-testid="linked-chip">
          {linkedCount} {linkedCount === 1 ? 'seat' : 'seats'} linked
        </span>
      )}

      {connected && !wallet.onTargetChain && deployment && (
        <button type="button" className="btn btn-warn" onClick={() => void wallet.switchChain()} disabled={wallet.switching} data-testid="switch-chain">
          {wallet.switching ? 'Switching…' : `Switch to ${chainName}`}
        </button>
      )}

      {connected ? (
        <>
          <span className={`chip ${wallet.onTargetChain ? 'chip-ok' : 'chip-warn'}`} title={wallet.account ?? ''} translate="no" data-testid="account-chip">
            <span className="dot" aria-hidden="true" />
            {shortAddress(wallet.account ?? '')}
            <span className="visually-hidden">
              {wallet.onTargetChain ? `connected on ${chainName}` : `connected on chain ${wallet.chainId ?? 'unknown'}, wrong network`}
            </span>
          </span>
          <button type="button" className="btn btn-ghost" onClick={wallet.disconnect} data-testid="disconnect">
            Disconnect
          </button>
        </>
      ) : (
        <div className="wallet-connect">
          {wallet.options.length > 1 ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                aria-expanded={pickerOpen}
                aria-controls="wallet-picker"
                onClick={() => setPickerOpen((o) => !o)}
                disabled={wallet.status === 'connecting'}
              >
                {wallet.status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
              </button>
              {pickerOpen && (
                <ul id="wallet-picker" className="wallet-picker" aria-label="Available wallets">
                  {wallet.options.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="btn btn-ghost wallet-option"
                        onClick={() => {
                          setPickerOpen(false);
                          void wallet.connect(o);
                        }}
                      >
                        {o.icon && <img src={o.icon} alt="" width={20} height={20} />}
                        {o.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void wallet.connect()}
              disabled={wallet.status === 'connecting' || wallet.status === 'discovering'}
              data-testid="connect"
            >
              {wallet.status === 'connecting' ? 'Connecting…' : wallet.status === 'discovering' ? 'Looking for wallets…' : 'Connect Wallet'}
            </button>
          )}
          {wallet.status === 'idle' && wallet.options.length === 0 && (
            <span className="muted small" data-testid="no-wallet">
              No browser wallet detected.{' '}
              <button type="button" className="link-btn" onClick={() => void wallet.refreshWallets()}>
                Check Again
              </button>
            </span>
          )}
        </div>
      )}
      {wallet.error && (
        <p className="inline-error" role="alert">
          {wallet.error}
        </p>
      )}
    </div>
  );
}
