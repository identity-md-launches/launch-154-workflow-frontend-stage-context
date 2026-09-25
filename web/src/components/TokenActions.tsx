import { useMemo, useState, type FormEvent } from 'react';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import type { Deployment } from '../lib/deployment';
import type { WalletState } from '../lib/useWallet';
import { useAsync } from '../lib/useAsync';
import { errorMessage, fmtAmount, parseAmount } from '../lib/format';
import { useTokenMeta } from './DeploymentPanel';
import { IDLE_TX, TxStatus, type TxState } from './TxStatus';

interface Props {
  deployment: Deployment | null;
  wallet: WalletState;
  txEnabled: boolean;
  chainReady: boolean;
  verificationError: string | null;
}

export function TokenActions({ deployment, wallet, txEnabled, chainReady, verificationError }: Props) {
  const meta = useTokenMeta(deployment);
  const decimals = meta.data?.decimals ?? 18;
  const symbol = meta.data?.symbol ?? 'COMPUTE';
  const account = wallet.account;

  const balanceFn = useMemo(() => {
    if (!deployment || !account) return null;
    return () =>
      deployment.publicClient.readContract({
        address: deployment.token.address as Address,
        abi: deployment.token.abi,
        functionName: 'balanceOf',
        args: [account],
      }) as Promise<bigint>;
  }, [deployment, account]);
  const balance = useAsync(balanceFn, [deployment, account], 30_000);

  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTx, setTransferTx] = useState<TxState>(IDLE_TX);

  const [spender, setSpender] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [approveTx, setApproveTx] = useState<TxState>(IDLE_TX);

  const allowanceFn = useMemo(() => {
    if (!deployment || !account || !isAddress(spender)) return null;
    return () =>
      deployment.publicClient.readContract({
        address: deployment.token.address as Address,
        abi: deployment.token.abi,
        functionName: 'allowance',
        args: [account, spender],
      }) as Promise<bigint>;
  }, [deployment, account, spender]);
  const allowance = useAsync(allowanceFn, [deployment, account, spender]);

  const transferValue = parseAmount(transferAmount, decimals);
  const approveValue = approveAmount.trim().toLowerCase() === 'max' ? 2n ** 256n - 1n : parseAmount(approveAmount, decimals);
  const transferErrors = {
    to: transferTo && !isAddress(transferTo) ? 'Enter a valid 0x address.' : transferTo && account && transferTo.toLowerCase() === account.toLowerCase() ? 'That is your own address.' : null,
    amount:
      transferAmount && transferValue === null
        ? `Enter a positive amount with at most ${decimals} decimals.`
        : transferValue !== null && balance.data !== null && transferValue > balance.data
          ? `Exceeds your balance of ${fmtAmount(balance.data, decimals)} ${symbol}.`
          : null,
  };
  const approveErrors = {
    spender: spender && !isAddress(spender) ? 'Enter a valid 0x address.' : null,
    amount: approveAmount && approveValue === null ? `Enter an amount or “max”.` : null,
  };

  async function runWrite(functionName: string, args: unknown[], setTx: (s: TxState) => void, label: string) {
    if (!deployment || !wallet.walletClient || !account) return;
    setTx({ phase: 'simulating', label });
    try {
      const { request } = await deployment.publicClient.simulateContract({
        address: deployment.token.address as Address,
        abi: deployment.token.abi,
        functionName,
        args,
        account,
      });
      setTx({ phase: 'signing', label });
      const hash = await wallet.walletClient.writeContract(request);
      setTx({ phase: 'pending', hash, label });
      const receipt = await deployment.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        setTx({ phase: 'failed', hash, label, message: 'The transaction reverted on chain.' });
        return;
      }
      setTx({ phase: 'confirmed', hash, label, message: `Block ${receipt.blockNumber.toString()}.` });
      balance.reload();
      allowance.reload();
    } catch (err) {
      setTx({ phase: 'failed', label, message: errorMessage(err) });
    }
  }

  const onTransfer = (e: FormEvent) => {
    e.preventDefault();
    if (!txEnabled || !isAddress(transferTo) || transferValue === null || transferErrors.to || transferErrors.amount) return;
    void runWrite('transfer', [transferTo, transferValue], setTransferTx, 'Transfer');
  };
  const onApprove = (e: FormEvent) => {
    e.preventDefault();
    if (!txEnabled || !isAddress(spender) || approveValue === null) return;
    void runWrite('approve', [spender, approveValue], setApproveTx, 'Approve');
  };

  const busy = (t: TxState) => t.phase === 'simulating' || t.phase === 'signing' || t.phase === 'pending';
  const gate = gateMessage({ deployment, wallet, chainReady, verificationError });

  return (
    <section className="card" aria-labelledby="token-h">
      <div className="card-head">
        <h2 id="token-h">
          <span translate="no">{symbol}</span> Token Actions
        </h2>
      </div>

      <dl className="kv">
        <dt>Your balance</dt>
        <dd className="num" translate="no" aria-live="polite" data-testid="balance">
          {!account
            ? 'Connect a wallet to read your balance.'
            : balance.data !== null
              ? `${fmtAmount(balance.data, decimals)} ${symbol}`
              : balance.error
                ? balance.error
                : 'Loading…'}
        </dd>
      </dl>

      {gate && (
        <p className="notice" role="status" data-testid="tx-gate">
          {gate}
        </p>
      )}

      <form className="stack" onSubmit={onTransfer} aria-labelledby="transfer-h" noValidate>
        <h3 id="transfer-h">Transfer</h3>
        <label className="field">
          <span>Recipient address</span>
          <input
            name="transferTo"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value.trim())}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-invalid={Boolean(transferErrors.to)}
            aria-describedby="transfer-to-err"
          />
          <span id="transfer-to-err" className="field-error">
            {transferErrors.to}
          </span>
        </label>
        <label className="field">
          <span>Amount ({symbol})</span>
          <input
            name="transferAmount"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            placeholder="e.g. 12.5"
            autoComplete="off"
            inputMode="decimal"
            aria-invalid={Boolean(transferErrors.amount)}
            aria-describedby="transfer-amount-err"
          />
          <span id="transfer-amount-err" className="field-error">
            {transferErrors.amount}
          </span>
        </label>
        <p className="muted small">
          Sends {transferValue !== null ? `${fmtAmount(transferValue, decimals)} ${symbol}` : `${symbol}`} from your wallet to the recipient. Transfers cannot be reversed.
        </p>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!txEnabled || busy(transferTx) || !isAddress(transferTo) || transferValue === null || Boolean(transferErrors.to || transferErrors.amount)}
          data-testid="transfer-submit"
        >
          {busy(transferTx) ? 'Transferring…' : `Send ${symbol}`}
        </button>
        <TxStatus tx={transferTx} network={deployment?.network ?? null} />
      </form>

      <form className="stack" onSubmit={onApprove} aria-labelledby="approve-h" noValidate>
        <h3 id="approve-h">Approve Spender</h3>
        <label className="field">
          <span>Spender address</span>
          <input
            name="spender"
            value={spender}
            onChange={(e) => setSpender(e.target.value.trim())}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(approveErrors.spender)}
            aria-describedby="spender-err"
          />
          <span id="spender-err" className="field-error">
            {approveErrors.spender}
          </span>
        </label>
        <label className="field">
          <span>Allowance ({symbol}, or “max”)</span>
          <input
            name="approveAmount"
            value={approveAmount}
            onChange={(e) => setApproveAmount(e.target.value)}
            placeholder="e.g. 100 or max"
            autoComplete="off"
            inputMode="decimal"
            aria-invalid={Boolean(approveErrors.amount)}
            aria-describedby="approve-amount-err"
          />
          <span id="approve-amount-err" className="field-error">
            {approveErrors.amount}
          </span>
        </label>
        <p className="muted small" aria-live="polite">
          {isAddress(spender) && account
            ? allowance.data !== null
              ? `Current allowance: ${allowance.data === 2n ** 256n - 1n ? 'unlimited' : `${fmtAmount(allowance.data, decimals)} ${symbol}`}. `
              : allowance.loading
                ? 'Reading current allowance… '
                : ''
            : ''}
          Approve replaces the previous allowance; set it to 0 first if you want to avoid the ERC-20 allowance race.
        </p>
        <button type="submit" className="btn btn-primary" disabled={!txEnabled || busy(approveTx) || !isAddress(spender) || approveValue === null} data-testid="approve-submit">
          {busy(approveTx) ? 'Approving…' : 'Set Allowance'}
        </button>
        <TxStatus tx={approveTx} network={deployment?.network ?? null} />
      </form>
    </section>
  );
}

export function gateMessage({
  deployment,
  wallet,
  chainReady,
  verificationError,
}: {
  deployment: Deployment | null;
  wallet: WalletState;
  chainReady: boolean;
  verificationError: string | null;
}): string | null {
  if (!deployment) return 'Waiting for deployment configuration…';
  if (verificationError) return `Transactions are disabled: ${verificationError}.`;
  if (!chainReady) return 'Transactions are disabled until the contract code and ABI hashes are verified on the configured RPC…';
  if (wallet.status !== 'connected') return 'Connect a wallet to send transactions.';
  if (!wallet.onTargetChain) return `Your wallet is on chain ${wallet.chainId ?? 'unknown'}. Switch to ${deployment.network?.name ?? `chain ${deployment.manifest.chainId}`} to continue.`;
  return null;
}
