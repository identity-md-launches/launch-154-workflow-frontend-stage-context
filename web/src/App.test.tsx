import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { decodeFunctionData } from 'viem';
import { App } from './App';
import { ACCOUNT, OTHER, MANIFEST, TOKEN, contributors, createMockProvider, defaultChainState, fakeRpcFetch, handleRpc, manifestRoutes, mockFetch, workers, type FakeChainState } from './test/fixtures';
import { universalRouterAbi } from './lib/uniswapAbi';

type Provider = ReturnType<typeof createMockProvider>;

function install(state: FakeChainState, provider: Provider | null, apiRoutes: Record<string, unknown> = { contributors, workers }) {
  const api = mockFetch({ ...manifestRoutes(), ...apiRoutes });
  vi.stubGlobal('fetch', fakeRpcFetch(state, api));
  const win = window as Window & { ethereum?: unknown };
  if (provider) win.ethereum = provider;
  else delete win.ethereum;
}

async function connect(user: ReturnType<typeof userEvent.setup>) {
  const btn = await screen.findByTestId('connect', {}, { timeout: 4000 });
  await waitFor(() => expect(btn).toBeEnabled());
  await user.click(btn);
  await screen.findByTestId('account-chip');
}

describe('App', () => {
  let state: FakeChainState;
  beforeEach(() => {
    state = defaultChainState();
    window.location.hash = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as Window & { ethereum?: unknown }).ethereum;
  });

  it('renders live deployment reads and the dashboard without a wallet, with transactions gated', async () => {
    install(state, null);
    render(<App />);

    // deployment reads from the manifest-configured RPC
    expect(await screen.findByText('Seat Compute / COMPUTE')).toBeInTheDocument();
    expect(screen.getByText(/1,000,000,000 COMPUTE/)).toBeInTheDocument();
    expect(screen.getByText('imd-compute')).toBeInTheDocument();
    expect(screen.getAllByText(TOKEN.address.toLowerCase()).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /view on explorer/i })[0]).toHaveAttribute('href', expect.stringContaining('sepolia.etherscan.io/address/'));

    // dashboard rows sorted by outputTokens desc
    const rows = await screen.findAllByTestId('seat-row');
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['7', '88', '1199', '9001'].map((s) => expect.stringContaining(s)));
    expect(screen.getByText(/plane-reported, not audited billing/)).toBeInTheDocument();

    // no wallet: connect button + hint, transaction controls disabled
    expect(await screen.findByTestId('no-wallet', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
    expect(screen.getByTestId('swap-submit')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('tx-gate')).toHaveTextContent(/Connect a wallet/));
  });

  it('filters, searches and sorts the table and mirrors state in the URL hash', async () => {
    install(state, null);
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByTestId('seat-row');

    await user.type(screen.getByLabelText(/search seat or wallet/i), '0x2222');
    await waitFor(() => expect(screen.getAllByTestId('seat-row')).toHaveLength(1));
    expect(window.location.hash).toContain('q=0x2222');
    await user.clear(screen.getByLabelText(/search seat or wallet/i));

    await user.click(screen.getByLabelText(/online only/i));
    await waitFor(() => expect(screen.getAllByTestId('seat-row')).toHaveLength(2));
    await user.selectOptions(screen.getByLabelText(/runtime/i), 'codex');
    await waitFor(() => expect(screen.getAllByTestId('seat-row')).toHaveLength(1));
    expect(window.location.hash).toContain('online=1');
    expect(window.location.hash).toContain('runtime=codex');

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => expect(screen.getAllByTestId('seat-row')).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: /^Accepted/ }));
    let first = within(screen.getAllByTestId('seat-row')[0]!).getAllByRole('cell')[0]!;
    expect(first).toHaveTextContent('7'); // 49 accepted, desc
    await user.click(screen.getByRole('button', { name: /^Accepted/ }));
    first = within(screen.getAllByTestId('seat-row')[0]!).getAllByRole('cell')[0]!;
    expect(first).toHaveTextContent('9001'); // 0 accepted, asc
    expect(window.location.hash).toContain('sort=accepted');
  });

  it('shows an error state when the API is unreachable and no snapshot exists', async () => {
    install(state, null, {});
    render(<App />);
    expect(await screen.findByText(/Could not load api.imd.fun/)).toBeInTheDocument();
  });

  it('connects, highlights every linked seat, handles wrong chain via switch + add, and clears on disconnect', async () => {
    const provider = createMockProvider({ chainId: 1, knownChains: [1], rpc: (m, p) => handleRpc(state, m, p) });
    install(state, provider);
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByTestId('seat-row');
    await connect(user);

    // wrong chain state
    expect(screen.getByTestId('switch-chain')).toHaveTextContent('Switch to Sepolia');
    expect(screen.getByTestId('tx-gate')).toHaveTextContent(/Switch to Sepolia/);
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();

    // linked seats (2 contributor rows share the wallet, case-insensitive)
    expect(screen.getByTestId('linked-chip')).toHaveTextContent('2 seats linked');
    expect(document.querySelectorAll('tr[data-linked="true"]')).toHaveLength(2);

    // switch fails with 4902 → add chain with walletAddChain → switch again
    await user.click(screen.getByTestId('switch-chain'));
    await waitFor(() => expect(screen.queryByTestId('switch-chain')).not.toBeInTheDocument());
    const methods = provider.calls.map((c) => c.method);
    expect(methods).toContain('wallet_addEthereumChain');
    const addCall = provider.calls.find((c) => c.method === 'wallet_addEthereumChain')!;
    expect(addCall.params[0]).toEqual({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: MANIFEST.network!.rpcUrls,
      nativeCurrency: MANIFEST.network!.nativeCurrency,
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    });
    await waitFor(() => expect(screen.queryByTestId('tx-gate')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('1,000 COMPUTE'));

    // account change recomputes matches
    act(() => provider.emit('accountsChanged', [OTHER]));
    await waitFor(() => expect(screen.getByTestId('linked-chip')).toHaveTextContent('0 seats linked'));
    expect(document.querySelectorAll('tr[data-linked="true"]')).toHaveLength(0);
    act(() => provider.emit('accountsChanged', [ACCOUNT]));
    await waitFor(() => expect(screen.getByTestId('linked-chip')).toHaveTextContent('2 seats linked'));

    // disconnect clears highlights and chip
    await user.click(screen.getByTestId('disconnect'));
    await waitFor(() => expect(screen.queryByTestId('linked-chip')).not.toBeInTheDocument());
    expect(document.querySelectorAll('tr[data-linked="true"]')).toHaveLength(0);
    expect(screen.getByTestId('connect')).toBeInTheDocument();
  });

  it('simulates and sends a transfer, and surfaces revert reasons', async () => {
    const provider = createMockProvider({ chainId: MANIFEST.chainId, knownChains: [MANIFEST.chainId], rpc: (m, p) => handleRpc(state, m, p) });
    install(state, provider);
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await waitFor(() => expect(screen.queryByTestId('tx-gate')).not.toBeInTheDocument());

    const to = screen.getByLabelText(/recipient address/i);
    const amount = screen.getByLabelText(/^Amount \(COMPUTE\)/i);
    await user.type(to, 'nope');
    expect(screen.getByText('Enter a valid 0x address.')).toBeInTheDocument();
    await user.clear(to);
    await user.type(to, OTHER);
    await user.type(amount, '5000');
    await waitFor(() => expect(screen.getByText(/Exceeds your balance/)).toBeInTheDocument());
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '12.5');
    await waitFor(() => expect(screen.getByTestId('transfer-submit')).toBeEnabled());
    expect(screen.getByText(/Sends 12.5 COMPUTE/)).toBeInTheDocument();

    await user.click(screen.getByTestId('transfer-submit'));
    await waitFor(() => expect(screen.getByText(/Transfer: Confirmed/)).toBeInTheDocument(), { timeout: 8000 });
    expect(state.txs).toHaveLength(1);
    expect(state.txs[0]!.to.toLowerCase()).toBe(TOKEN.address.toLowerCase());
    const decoded = decodeFunctionData({ abi: (await import('../public/abi/SeatCompute.json')).default as never, data: state.txs[0]!.data }) as { functionName: string; args: [string, bigint] };
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args[0].toLowerCase()).toBe(OTHER);
    expect(decoded.args[1]).toBe(12_500_000_000_000_000_000n);
    expect(screen.getByRole('link', { name: /view transaction/i })).toHaveAttribute('href', expect.stringContaining('sepolia.etherscan.io/tx/0x'));

    // revert in simulation is shown, nothing is sent
    state.revertOn = 'transfer';
    await user.clear(amount);
    await user.type(amount, '1');
    await user.click(screen.getByTestId('transfer-submit'));
    await waitFor(() => expect(screen.getByText(/Transfer: Failed/)).toBeInTheDocument());
    expect(screen.getByText(/ERC20InsufficientBalance/)).toBeInTheDocument();
    expect(state.txs).toHaveLength(1);
  });

  it('sets an allowance through approve', async () => {
    const provider = createMockProvider({ chainId: MANIFEST.chainId, knownChains: [MANIFEST.chainId], rpc: (m, p) => handleRpc(state, m, p) });
    install(state, provider);
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await waitFor(() => expect(screen.queryByTestId('tx-gate')).not.toBeInTheDocument());
    await user.type(screen.getByLabelText(/spender address/i), OTHER);
    await user.type(screen.getByLabelText(/^Allowance/i), 'max');
    await waitFor(() => expect(screen.getByTestId('approve-submit')).toBeEnabled());
    await user.click(screen.getByTestId('approve-submit'));
    await waitFor(() => expect(screen.getByText(/Approve: Confirmed/)).toBeInTheDocument(), { timeout: 8000 });
    const decoded = decodeFunctionData({ abi: (await import('../public/abi/SeatCompute.json')).default as never, data: state.txs[0]!.data }) as { functionName: string; args: [string, bigint] };
    expect(decoded.functionName).toBe('approve');
    expect(decoded.args[1]).toBe(2n ** 256n - 1n);
  });

  it('quotes through the quoter and swaps ETH → COMPUTE with the Universal Router', async () => {
    const provider = createMockProvider({ chainId: MANIFEST.chainId, knownChains: [MANIFEST.chainId], rpc: (m, p) => handleRpc(state, m, p) });
    install(state, provider);
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await waitFor(() => expect(screen.queryByTestId('tx-gate')).not.toBeInTheDocument());
    expect(await screen.findByText(/1 ETH ≈/)).toBeInTheDocument();

    await user.type(screen.getByTestId('swap-amount'), '0.001');
    await waitFor(() => expect(screen.getByTestId('quote')).toHaveTextContent('49,627 COMPUTE'), { timeout: 4000 });
    expect(screen.getByTestId('quote')).toHaveTextContent(/Minimum after 1% slippage: 49,130.73 COMPUTE/);
    await waitFor(() => expect(screen.getByTestId('swap-submit')).toBeEnabled());

    await user.click(screen.getByTestId('swap-submit'));
    await waitFor(() => expect(screen.getByText(/Swap: Confirmed/)).toBeInTheDocument(), { timeout: 8000 });
    const tx = state.txs[0]!;
    expect(tx.to.toLowerCase()).toBe(MANIFEST.network!.uniswapV4!.universalRouter);
    expect(tx.value).toBe(10n ** 15n);
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data: tx.data });
    expect(decoded.functionName).toBe('execute');
    expect(decoded.args[0]).toBe('0x10');
  });

  it('requires token and Permit2 approvals before selling COMPUTE and shows quote reverts', async () => {
    const provider = createMockProvider({ chainId: MANIFEST.chainId, knownChains: [MANIFEST.chainId], rpc: (m, p) => handleRpc(state, m, p) });
    install(state, provider);
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await waitFor(() => expect(screen.queryByTestId('tx-gate')).not.toBeInTheDocument());

    await user.click(screen.getByLabelText(/sell COMPUTE for ETH/i));
    await user.type(screen.getByTestId('swap-amount'), '100');
    await waitFor(() => expect(screen.getByTestId('approve-permit2')).toBeInTheDocument());
    expect(screen.getByTestId('swap-submit')).toBeDisabled();

    // step 1: token approve to Permit2
    await user.click(screen.getByTestId('approve-permit2'));
    await waitFor(() => expect(state.txs).toHaveLength(1), { timeout: 8000 });
    state.allowances[`${ACCOUNT.toLowerCase()}:${MANIFEST.network!.uniswapV4!.permit2}`] = 100n * 10n ** 18n;
    await waitFor(() => expect(screen.queryByTestId('approve-permit2')).not.toBeInTheDocument(), { timeout: 8000 });

    // step 2: Permit2 approve to router
    await waitFor(() => expect(screen.getByTestId('approve-router')).toBeEnabled());
    await user.click(screen.getByTestId('approve-router'));
    await waitFor(() => expect(state.txs).toHaveLength(2), { timeout: 8000 });
    expect(state.txs[1]!.to.toLowerCase()).toBe(MANIFEST.network!.uniswapV4!.permit2);
    state.permitAllowances[`${ACCOUNT.toLowerCase()}:${TOKEN.address.toLowerCase()}:${MANIFEST.network!.uniswapV4!.universalRouter}`] = { amount: 100n * 10n ** 18n, expiration: Math.floor(Date.now() / 1000) + 3600 };
    await waitFor(() => expect(screen.queryByTestId('approve-router')).not.toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('swap-submit')).toBeEnabled(), { timeout: 4000 });

    // quote revert reason surfaces and disables the swap
    state.revertOn = 'quote';
    await user.type(screen.getByTestId('swap-amount'), '0');
    await waitFor(() => expect(screen.getByTestId('quote')).toHaveTextContent(/Quote failed/), { timeout: 4000 });
    expect(screen.getByTestId('quote')).toHaveTextContent(/PoolNotInitialized/);
    expect(screen.getByTestId('swap-submit')).toBeDisabled();
  });

  it('disables transactions when the RPC reports a different chain than the manifest', async () => {
    state.chainId = 1;
    const provider = createMockProvider({ chainId: MANIFEST.chainId, knownChains: [MANIFEST.chainId], rpc: (m, p) => handleRpc(state, m, p) });
    install(state, provider);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('tx-gate')).toHaveTextContent(/RPC reports chain 1, expected 11155111/));
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
    expect(screen.getByTestId('swap-submit')).toBeDisabled();
  });
});
