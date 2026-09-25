import { useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { formatUnits, zeroAddress } from 'viem';
import type { Deployment } from '../lib/deployment';
import type { WalletState } from '../lib/useWallet';
import { useAsync } from '../lib/useAsync';
import { errorMessage, fmtAmount, parseAmount } from '../lib/format';
import { SWAP_DEFAULTS } from '../config';
import { permit2Abi, quoterAbi, stateViewAbi, universalRouterAbi } from '../lib/uniswapAbi';
import { applySlippage, buildExecuteArgs, buildPoolKey, planSwap, poolId, priceFromSqrtX96, LAUNCH_POOL } from '../lib/swap';
import { useTokenMeta } from './DeploymentPanel';
import { IDLE_TX, TxStatus, type TxState } from './TxStatus';

interface Props {
  deployment: Deployment | null;
  wallet: WalletState;
  txEnabled: boolean;
  chainReady: boolean;
}

type Direction = 'buy' | 'sell'; // buy = ETH → COMPUTE, sell = COMPUTE → ETH

interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate: bigint;
  direction: Direction;
}

export function SwapPanel({ deployment, wallet, txEnabled, chainReady }: Props) {
  const meta = useTokenMeta(deployment);
  const decimals = meta.data?.decimals ?? 18;
  const symbol = meta.data?.symbol ?? 'COMPUTE';
  const native = deployment?.network?.nativeCurrency ?? { symbol: 'ETH', decimals: 18, name: 'Ether' };
  const uni = deployment?.network?.uniswapV4 ?? null;
  const account = wallet.account;

  const [direction, setDirection] = useState<Direction>('buy');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(SWAP_DEFAULTS.slippageBps);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [approveTx, setApproveTx] = useState<TxState>(IDLE_TX);
  const [permitTx, setPermitTx] = useState<TxState>(IDLE_TX);
  const [swapTx, setSwapTx] = useState<TxState>(IDLE_TX);

  const poolKey = useMemo(() => (deployment ? buildPoolKey(deployment.token.address as Address, LAUNCH_POOL) : null), [deployment]);
  const inDecimals = direction === 'buy' ? native.decimals : decimals;
  const outDecimals = direction === 'buy' ? decimals : native.decimals;
  const inSymbol = direction === 'buy' ? native.symbol : symbol;
  const outSymbol = direction === 'buy' ? symbol : native.symbol;
  const amountIn = parseAmount(amount, inDecimals);
  const inputCurrency: Address = direction === 'buy' ? zeroAddress : ((deployment?.token.address ?? zeroAddress) as Address);

  // Pool state from StateView: price and liquidity.
  const poolFn = useMemo(() => {
    if (!deployment || !uni || !poolKey) return null;
    const id = poolId(poolKey);
    return async () => {
      const [slot0, liquidity] = await Promise.all([
        deployment.publicClient.readContract({ address: uni.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [id] }),
        deployment.publicClient.readContract({ address: uni.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [id] }),
      ]);
      return { sqrtPriceX96: slot0[0], tick: slot0[1], lpFee: slot0[3], liquidity, id };
    };
  }, [deployment, uni, poolKey]);
  const pool = useAsync(poolFn, [deployment, uni, poolKey], 60_000);
  const price = pool.data && pool.data.sqrtPriceX96 > 0n ? priceFromSqrtX96(pool.data.sqrtPriceX96, native.decimals, decimals) : null;
  const poolInitialised = pool.data ? pool.data.sqrtPriceX96 > 0n : null;

  // Balances for the input side.
  const balancesFn = useMemo(() => {
    if (!deployment || !account) return null;
    return async () => {
      const [eth, tok] = await Promise.all([
        deployment.publicClient.getBalance({ address: account }),
        deployment.publicClient.readContract({ address: deployment.token.address as Address, abi: deployment.token.abi, functionName: 'balanceOf', args: [account] }) as Promise<bigint>,
      ]);
      return { eth, tok };
    };
  }, [deployment, account]);
  const balances = useAsync(balancesFn, [deployment, account], 30_000);

  // Approval state for token → ETH swaps: token allowance to Permit2, and Permit2 allowance to the router.
  const approvalsFn = useMemo(() => {
    if (!deployment || !uni || !account || direction !== 'sell') return null;
    return async () => {
      const [tokenAllowance, permit] = await Promise.all([
        deployment.publicClient.readContract({ address: deployment.token.address as Address, abi: deployment.token.abi, functionName: 'allowance', args: [account, uni.permit2] }) as Promise<bigint>,
        deployment.publicClient.readContract({ address: uni.permit2, abi: permit2Abi, functionName: 'allowance', args: [account, deployment.token.address as Address, uni.universalRouter] }),
      ]);
      return { tokenAllowance, permitAmount: permit[0], permitExpiration: Number(permit[1]) };
    };
  }, [deployment, uni, account, direction]);
  const approvals = useAsync(approvalsFn, [deployment, uni, account, direction]);

  const needsTokenApproval = direction === 'sell' && amountIn !== null && approvals.data !== null && approvals.data.tokenAllowance < amountIn;
  const needsPermit =
    direction === 'sell' &&
    amountIn !== null &&
    approvals.data !== null &&
    (approvals.data.permitAmount < amountIn || approvals.data.permitExpiration <= Math.floor(Date.now() / 1000));

  // Quote (debounced) through the quoter's simulateContract; never a transaction.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!deployment || !uni || !poolKey || amountIn === null || !chainReady) return;
    const maxUint128 = 2n ** 128n - 1n;
    if (amountIn > maxUint128) {
      setQuoteError('Amount is too large for a single swap.');
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const plan = planSwap(poolKey, inputCurrency, amountIn, 0n);
        const { result } = await deployment.publicClient.simulateContract({
          address: uni.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey: plan.poolKey, zeroForOne: plan.zeroForOne, exactAmount: amountIn, hookData: '0x' }],
        });
        if (cancelled) return;
        setQuote({ amountIn, amountOut: result[0], gasEstimate: result[1], direction });
      } catch (err) {
        if (!cancelled) setQuoteError(`Quote failed: ${errorMessage(err)}`);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setQuoting(false);
    };
  }, [deployment, uni, poolKey, amountIn, inputCurrency, direction, chainReady]);

  const minOut = quote ? applySlippage(quote.amountOut, slippageBps) : null;
  const busy = (t: TxState) => t.phase === 'simulating' || t.phase === 'signing' || t.phase === 'pending';
  const anyBusy = busy(approveTx) || busy(permitTx) || busy(swapTx);
  const insufficient =
    amountIn !== null && balances.data !== null && (direction === 'buy' ? amountIn > balances.data.eth : amountIn > balances.data.tok);

  async function sendStep(
    setTx: (s: TxState) => void,
    label: string,
    build: () => Promise<object>,
    after?: () => void,
  ) {
    if (!deployment || !wallet.walletClient) return;
    setTx({ phase: 'simulating', label });
    try {
      const request = (await build()) as Parameters<NonNullable<WalletState['walletClient']>['writeContract']>[0];
      setTx({ phase: 'signing', label });
      const hash = await wallet.walletClient.writeContract(request);
      setTx({ phase: 'pending', hash, label });
      const receipt = await deployment.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        setTx({ phase: 'failed', hash, label, message: 'The transaction reverted on chain.' });
        return;
      }
      setTx({ phase: 'confirmed', hash, label });
      after?.();
    } catch (err) {
      setTx({ phase: 'failed', label, message: errorMessage(err) });
    }
  }

  const onApproveToken = () =>
    sendStep(
      setApproveTx,
      `Approve ${symbol} for Permit2`,
      async () => {
        const { request } = await deployment!.publicClient.simulateContract({
          address: deployment!.token.address as Address,
          abi: deployment!.token.abi,
          functionName: 'approve',
          args: [uni!.permit2, amountIn!],
          account: account!,
        });
        return request;
      },
      () => approvals.reload(),
    );

  const onPermit = () =>
    sendStep(
      setPermitTx,
      'Permit2 allowance for the router',
      async () => {
        const expiration = Math.floor(Date.now() / 1000) + SWAP_DEFAULTS.permit2ExpirationSeconds;
        const { request } = await deployment!.publicClient.simulateContract({
          address: uni!.permit2,
          abi: permit2Abi,
          functionName: 'approve',
          args: [deployment!.token.address as Address, uni!.universalRouter, amountIn!, expiration],
          account: account!,
        });
        return request;
      },
      () => approvals.reload(),
    );

  const onSwap = () =>
    sendStep(
      setSwapTx,
      'Swap',
      async () => {
        const plan = planSwap(poolKey!, inputCurrency, amountIn!, minOut!);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + SWAP_DEFAULTS.deadlineSeconds);
        const { args, value } = buildExecuteArgs(plan, deadline);
        const { request } = await deployment!.publicClient.simulateContract({
          address: uni!.universalRouter,
          abi: universalRouterAbi,
          functionName: 'execute',
          args,
          value,
          account: account!,
        });
        return request;
      },
      () => {
        balances.reload();
        approvals.reload();
        pool.reload();
      },
    );

  const swapReady =
    txEnabled && uni !== null && amountIn !== null && quote !== null && minOut !== null && quote.amountIn === amountIn && quote.direction === direction && !insufficient && !anyBusy && !needsTokenApproval && !needsPermit;

  if (deployment && !deployment.network) {
    return (
      <section className="card" aria-labelledby="swap-h">
        <h2 id="swap-h">Swap</h2>
        <p className="notice">Swaps are disabled: chain {deployment.manifest.chainId} is not in the vetted network table, so no router or quoter addresses are available.</p>
      </section>
    );
  }
  if (deployment && !uni) {
    return (
      <section className="card" aria-labelledby="swap-h">
        <h2 id="swap-h">Swap</h2>
        <p className="notice">Swaps are disabled: the network block has no Uniswap v4 addresses.</p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="swap-h">
      <div className="card-head">
        <h2 id="swap-h">
          Swap <span translate="no">{native.symbol}</span> ⇄ <span translate="no">{symbol}</span>
        </h2>
        <span className="muted small">Uniswap v4 · {LAUNCH_POOL.fee / 10_000}% pool · no hook</span>
      </div>

      <dl className="kv">
        <dt>Pool price</dt>
        <dd className="num" aria-live="polite" translate="no">
          {price
            ? `1 ${native.symbol} ≈ ${fmtLoose(price.token1PerToken0)} ${symbol} · 1 ${symbol} ≈ ${fmtLoose(price.token0PerToken1, 10)} ${native.symbol}`
            : poolInitialised === false
              ? 'Pool not initialised'
              : pool.error
                ? `Pool read failed: ${pool.error}`
                : 'Loading…'}
        </dd>
        <dt>Liquidity</dt>
        <dd className="num" translate="no">
          {pool.data ? pool.data.liquidity.toString() : '…'}
        </dd>
      </dl>

      <form className="stack" onSubmit={(e) => e.preventDefault()} aria-label="Swap form" noValidate>
        <fieldset className="seg" aria-label="Direction">
          <legend className="visually-hidden">Direction</legend>
          <label className={direction === 'buy' ? 'seg-on' : ''}>
            <input type="radio" name="direction" value="buy" checked={direction === 'buy'} onChange={() => { setDirection('buy'); setAmount(''); }} />
            Buy {symbol} with {native.symbol}
          </label>
          <label className={direction === 'sell' ? 'seg-on' : ''}>
            <input type="radio" name="direction" value="sell" checked={direction === 'sell'} onChange={() => { setDirection('sell'); setAmount(''); }} />
            Sell {symbol} for {native.symbol}
          </label>
        </fieldset>

        <label className="field">
          <span>
            You pay ({inSymbol})
            {balances.data && account && (
              <span className="muted">
                {' '}
                · balance {direction === 'buy' ? fmtAmount(balances.data.eth, native.decimals) : fmtAmount(balances.data.tok, decimals)}
              </span>
            )}
          </span>
          <input
            name="swapAmount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={direction === 'buy' ? 'e.g. 0.01' : 'e.g. 1000'}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(amount && amountIn === null) || insufficient}
            aria-describedby="swap-amount-err"
            data-testid="swap-amount"
          />
          <span id="swap-amount-err" className="field-error">
            {amount && amountIn === null ? `Enter a positive amount with at most ${inDecimals} decimals.` : insufficient ? `Exceeds your ${inSymbol} balance.` : ''}
          </span>
        </label>

        <label className="field">
          <span>Max slippage (%)</span>
          <input
            name="slippage"
            type="number"
            min={0}
            max={50}
            step={0.1}
            inputMode="decimal"
            autoComplete="off"
            value={slippageBps / 100}
            onChange={(e) => setSlippageBps(Math.round(Math.min(50, Math.max(0, Number(e.target.value) || 0)) * 100))}
          />
        </label>

        <div className="quote" aria-live="polite" data-testid="quote">
          {quoting && <span className="muted">Fetching quote…</span>}
          {!quoting && quote && minOut !== null && (
            <>
              <div>
                You receive about <strong className="num" translate="no">{fmtAmount(quote.amountOut, outDecimals)} {outSymbol}</strong>
              </div>
              <div className="muted small">
                Minimum after {slippageBps / 100}% slippage: <span className="num" translate="no">{fmtAmount(minOut, outDecimals)} {outSymbol}</span> · rate 1 {inSymbol} ≈{' '}
                <span className="num" translate="no">{fmtLoose(rate(quote.amountIn, inDecimals, quote.amountOut, outDecimals), 8)} {outSymbol}</span>
              </div>
            </>
          )}
          {!quoting && quoteError && (
            <span className="inline-error" role="alert">
              {quoteError}
            </span>
          )}
        </div>

        {direction === 'sell' && account && (
          <ol className="steps" aria-label="Approval steps">
            <li className={needsTokenApproval ? '' : 'step-done'}>
              <span>1. Approve {symbol} for Permit2 {approvals.data && !needsTokenApproval ? '(done)' : ''}</span>
              {needsTokenApproval && (
                <button type="button" className="btn btn-secondary" onClick={() => void onApproveToken()} disabled={!txEnabled || anyBusy} data-testid="approve-permit2">
                  {busy(approveTx) ? 'Approving…' : 'Approve'}
                </button>
              )}
              <TxStatus tx={approveTx} network={deployment?.network ?? null} />
            </li>
            <li className={needsPermit ? '' : 'step-done'}>
              <span>2. Permit2 allowance for the Universal Router {approvals.data && !needsPermit ? '(done)' : ''}</span>
              {needsPermit && (
                <button type="button" className="btn btn-secondary" onClick={() => void onPermit()} disabled={!txEnabled || anyBusy || needsTokenApproval} data-testid="approve-router">
                  {busy(permitTx) ? 'Approving…' : 'Allow Router'}
                </button>
              )}
              <TxStatus tx={permitTx} network={deployment?.network ?? null} />
            </li>
          </ol>
        )}

        <p className="muted small">
          {direction === 'buy'
            ? `Sends ${amountIn !== null ? fmtAmount(amountIn, native.decimals) : '…'} ${native.symbol} as transaction value to the Universal Router; no approval needed.`
            : `Swaps ${amountIn !== null ? fmtAmount(amountIn, decimals) : '…'} ${symbol} through the Universal Router after both approvals.`}{' '}
          The swap is simulated before your wallet is asked to sign.
        </p>

        <button type="button" className="btn btn-primary" onClick={() => void onSwap()} disabled={!swapReady} data-testid="swap-submit">
          {busy(swapTx) ? 'Swapping…' : `Swap ${inSymbol} for ${outSymbol}`}
        </button>
        <TxStatus tx={swapTx} network={deployment?.network ?? null} />
        {!txEnabled && (
          <p className="muted small" role="status">
            {!chainReady ? 'Swap is disabled until the deployment is verified on the configured RPC.' : wallet.status !== 'connected' ? 'Connect a wallet on the launch chain to swap.' : !wallet.onTargetChain ? 'Switch your wallet to the launch chain to swap.' : ''}
          </p>
        )}
      </form>
    </section>
  );
}

function rate(amountIn: bigint, inDec: number, amountOut: bigint, outDec: number): number {
  const a = Number(formatUnits(amountIn, inDec));
  const b = Number(formatUnits(amountOut, outDec));
  return a > 0 ? b / a : 0;
}

const looseFmtCache = new Map<number, Intl.NumberFormat>();
function fmtLoose(n: number, maxSig = 6): string {
  if (!Number.isFinite(n)) return '—';
  let f = looseFmtCache.get(maxSig);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { maximumSignificantDigits: maxSig });
    looseFmtCache.set(maxSig, f);
  }
  return f.format(n);
}
