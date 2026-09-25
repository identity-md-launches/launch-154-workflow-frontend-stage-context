import { explorerTx, type NetworkBlock } from '../lib/deployment';

export type TxPhase = 'idle' | 'simulating' | 'signing' | 'pending' | 'confirmed' | 'failed';

export interface TxState {
  phase: TxPhase;
  hash?: `0x${string}`;
  message?: string;
  label?: string;
}

export const IDLE_TX: TxState = { phase: 'idle' };

export function TxStatus({ tx, network }: { tx: TxState; network: NetworkBlock | null }) {
  if (tx.phase === 'idle') return null;
  const link = tx.hash ? explorerTx(network, tx.hash) : null;
  const cls = tx.phase === 'failed' ? 'inline-error' : tx.phase === 'confirmed' ? 'inline-ok' : 'muted';
  const text: Record<TxPhase, string> = {
    idle: '',
    simulating: 'Simulating…',
    signing: 'Confirm in your wallet…',
    pending: 'Transaction sent, waiting for confirmation…',
    confirmed: 'Confirmed.',
    failed: 'Failed.',
  };
  return (
    <p className={`tx-status ${cls}`} role={tx.phase === 'failed' ? 'alert' : 'status'} aria-live="polite">
      {tx.label ? `${tx.label}: ` : ''}
      {text[tx.phase]} {tx.message}
      {link && (
        <>
          {' '}
          <a href={link} target="_blank" rel="noreferrer noopener" translate="no">
            View Transaction ↗
          </a>
        </>
      )}
    </p>
  );
}
