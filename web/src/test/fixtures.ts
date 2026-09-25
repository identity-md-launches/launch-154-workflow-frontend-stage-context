import type { Hex } from 'viem';
import { encodeAbiParameters, encodeFunctionResult, decodeFunctionData, keccak256, toHex, stringToBytes } from 'viem';
import type { Eip1193Provider } from '../lib/wallet';
import type { ContributorsResponse, WorkersResponse } from '../lib/dashboard';
import type { DeploymentManifest } from '../lib/deployment';
import seatComputeAbi from '../../public/abi/SeatCompute.json';
import computeProjectAbi from '../../public/abi/ComputeProject.json';
import manifestJson from '../../public/imd-deployment.json';
import { quoterAbi, stateViewAbi, permit2Abi } from '../lib/uniswapAbi';

export const MANIFEST = manifestJson as unknown as DeploymentManifest;
export const TOKEN = MANIFEST.contracts.find((c) => c.name === 'SeatCompute')!;
export const PROJECT = MANIFEST.contracts.find((c) => c.name === 'ComputeProject')!;
export const ABIS: Record<string, unknown> = {
  'abi/SeatCompute.json': seatComputeAbi,
  'abi/ComputeProject.json': computeProjectAbi,
};

export const ACCOUNT = '0xB3763A57618A8842D5B5664651ea7b8EF6334329'; // matches contributor 88 below (case-insensitive)
export const OTHER = '0x1111111111111111111111111111111111111111';

export const contributors: ContributorsResponse = {
  receipts: 10,
  tokensPerCompletedJob: 1234,
  contributors: [
    { deviceKey: 'dev-a', wallet: '0xb3763a57618a8842d5b5664651ea7b8ef6334329', tokenId: '88', attempts: 10, accepted: 8, rejected: 1, pending: 1, wallClockMs: '3600000', inputTokens: '100', outputTokens: '5000', cachedInputTokens: '20', turns: 40 },
    { deviceKey: 'dev-b', wallet: '0xB3763A57618A8842D5B5664651EA7B8EF6334329', tokenId: '1199', attempts: 3, accepted: 1, rejected: 2, pending: 0, wallClockMs: '60000', inputTokens: '5', outputTokens: '900', cachedInputTokens: '0', turns: 3 },
    { deviceKey: 'dev-c', wallet: '0x2222222222222222222222222222222222222222', tokenId: '7', attempts: 50, accepted: 49, rejected: 0, pending: 1, wallClockMs: '7200000', inputTokens: '1000', outputTokens: '99000', cachedInputTokens: '500', turns: 300 },
    { wallet: null, tokenId: '9001', attempts: 0, accepted: 0, rejected: 0, pending: 0, wallClockMs: '0', inputTokens: '0', outputTokens: '0', cachedInputTokens: '0', turns: 0 },
  ],
};

export const NOW = Date.now();

export const workers: WorkersResponse = {
  count: 3,
  workers: [
    { deviceKey: 'dev-a', seat: { tokenId: '88' }, working: 1, daemonVersion: '0.1.0+aaaa', lastHeartbeatAt: new Date(NOW - 30_000).toISOString(), runtimes: [{ id: 'claude', version: '2' }] },
    { deviceKey: 'dev-zzz', seat: { tokenId: '1199' }, working: 0, daemonVersion: '0.1.0+bbbb', lastHeartbeatAt: new Date(NOW - 3_600_000).toISOString(), runtimes: [{ id: 'codex' }] },
    { deviceKey: 'dev-c', seat: { tokenId: '7' }, working: 0, daemonVersion: '0.1.0+cccc', lastHeartbeatAt: new Date(NOW - 10_000).toISOString(), runtimes: [{ id: 'claude' }, { id: 'codex' }] },
  ],
};

/** Simple fetch mock keyed by URL substring. */
export function mockFetch(routes: Record<string, unknown | (() => unknown)>, failing: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const f of failing) if (url.includes(f)) throw new TypeError('Failed to fetch');
    for (const [key, value] of Object.entries(routes)) {
      if (url.includes(key)) {
        const body = typeof value === 'function' ? (value as () => unknown)() : value;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

export function manifestRoutes(): Record<string, unknown> {
  return {
    'imd-deployment.json': MANIFEST,
    'abi/SeatCompute.json': seatComputeAbi,
    'abi/ComputeProject.json': computeProjectAbi,
  };
}

type Handler = (method: string, params: unknown[]) => unknown;

export interface MockProviderOptions {
  chainId?: number;
  accounts?: string[];
  /** chains the wallet knows; switching to another throws 4902 */
  knownChains?: number[];
  rpc?: Handler;
}

/** Minimal EIP-1193 provider double with event emission and chain switching semantics. */
export function createMockProvider(opts: MockProviderOptions = {}) {
  let chainId = opts.chainId ?? 1;
  const known = new Set(opts.knownChains ?? [chainId]);
  const accounts = opts.accounts ?? [ACCOUNT];
  const listeners = new Map<string, Set<(...a: never[]) => void>>();
  const calls: { method: string; params: unknown[] }[] = [];

  const emit = (event: string, ...args: unknown[]) => {
    for (const l of listeners.get(event) ?? []) (l as (...a: unknown[]) => void)(...args);
  };

  const provider: Eip1193Provider & { calls: typeof calls; emit: typeof emit; setChain: (id: number) => void } = {
    calls,
    emit,
    setChain(id: number) {
      chainId = id;
      emit('chainChanged', `0x${id.toString(16)}`);
    },
    async request({ method, params }) {
      const p = (params ?? []) as unknown[];
      calls.push({ method, params: p });
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return accounts;
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`;
        case 'wallet_switchEthereumChain': {
          const target = parseInt((p[0] as { chainId: string }).chainId, 16);
          if (!known.has(target)) {
            const err = new Error('Unrecognized chain ID') as Error & { code: number };
            err.code = 4902;
            throw err;
          }
          chainId = target;
          emit('chainChanged', `0x${target.toString(16)}`);
          return null;
        }
        case 'wallet_addEthereumChain': {
          const target = parseInt((p[0] as { chainId: string }).chainId, 16);
          known.add(target);
          return null;
        }
        default:
          if (opts.rpc) return opts.rpc(method, p);
          throw new Error(`unhandled ${method}`);
      }
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
  return provider;
}

/** Fake JSON-RPC for viem's http transport: answers eth_call by function selector. */
export interface FakeChainState {
  chainId: number;
  code: Record<string, Hex>;
  balances: Record<string, bigint>;
  tokenBalances: Record<string, bigint>;
  allowances: Record<string, bigint>;
  permitAllowances: Record<string, { amount: bigint; expiration: number }>;
  quoteOut: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  txs: { to: string; data: Hex; value: bigint }[];
  revertOn?: string; // function name that should revert in eth_call
}

export function defaultChainState(): FakeChainState {
  return {
    chainId: MANIFEST.chainId,
    code: { [TOKEN.address.toLowerCase()]: '0x6001', [PROJECT.address.toLowerCase()]: '0x6002' },
    balances: { [ACCOUNT.toLowerCase()]: 10n ** 18n },
    tokenBalances: { [ACCOUNT.toLowerCase()]: 1000n * 10n ** 18n },
    allowances: {},
    permitAllowances: {},
    quoteOut: 49_627n * 10n ** 18n,
    sqrtPriceX96: 560227709747861399187319382274582n,
    liquidity: 177284n,
    txs: [],
  };
}

const selector = (sig: string) => keccak256(stringToBytes(sig)).slice(0, 10);
const SEL = {
  name: selector('name()'),
  symbol: selector('symbol()'),
  decimals: selector('decimals()'),
  totalSupply: selector('totalSupply()'),
  balanceOf: selector('balanceOf(address)'),
  allowance: selector('allowance(address,address)'),
  transfer: selector('transfer(address,uint256)'),
  approve: selector('approve(address,uint256)'),
  token: selector('token()'),
  version: selector('version()'),
  siteLabel: selector('siteLabel()'),
  quote: selector('quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))'),
  getSlot0: selector('getSlot0(bytes32)'),
  getLiquidity: selector('getLiquidity(bytes32)'),
  permitAllowance: selector('allowance(address,address,address)'),
  permitApprove: selector('approve(address,address,uint160,uint48)'),
  execute: selector('execute(bytes,bytes[],uint256)'),
};

function str(v: string): Hex {
  return encodeAbiParameters([{ type: 'string' }], [v]);
}
function u256(v: bigint): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [v]);
}
function addr(v: string): Hex {
  return encodeAbiParameters([{ type: 'address' }], [v as Hex]);
}

export function ethCall(state: FakeChainState, tx: { to?: string; data?: Hex; value?: Hex; from?: string }): Hex {
  const to = (tx.to ?? '').toLowerCase();
  const data = tx.data ?? '0x';
  const sel = data.slice(0, 10);
  const uni = MANIFEST.network!.uniswapV4!;
  const revert = (reason: string): never => {
    const err = new Error('execution reverted') as Error & { code: number; data: Hex };
    err.code = 3;
    err.data = ('0x08c379a0' + encodeAbiParameters([{ type: 'string' }], [reason]).slice(2)) as Hex;
    throw err;
  };
  if (to === TOKEN.address.toLowerCase()) {
    if (sel === SEL.name) return str('Seat Compute');
    if (sel === SEL.symbol) return str('COMPUTE');
    if (sel === SEL.decimals) return u256(18n);
    if (sel === SEL.totalSupply) return u256(10n ** 27n);
    if (sel === SEL.balanceOf) {
      const { args } = decodeFunctionData({ abi: seatComputeAbi as never, data }) as unknown as { args: [string] };
      return u256(state.tokenBalances[args[0].toLowerCase()] ?? 0n);
    }
    if (sel === SEL.allowance) {
      const { args } = decodeFunctionData({ abi: seatComputeAbi as never, data }) as unknown as { args: [string, string] };
      return u256(state.allowances[`${args[0].toLowerCase()}:${args[1].toLowerCase()}`] ?? 0n);
    }
    if (sel === SEL.transfer) {
      if (state.revertOn === 'transfer') revert('ERC20InsufficientBalance');
      const { args } = decodeFunctionData({ abi: seatComputeAbi as never, data }) as unknown as { args: [string, bigint] };
      const bal = state.tokenBalances[(tx.from ?? '').toLowerCase()] ?? 0n;
      if (args[1] > bal) revert('ERC20InsufficientBalance');
      return encodeFunctionResult({ abi: seatComputeAbi as never, functionName: 'transfer', result: true } as never);
    }
    if (sel === SEL.approve) return encodeFunctionResult({ abi: seatComputeAbi as never, functionName: 'approve', result: true } as never);
  }
  if (to === PROJECT.address.toLowerCase()) {
    if (sel === SEL.token) return addr(TOKEN.address);
    if (sel === SEL.version) return u256(1n);
    if (sel === SEL.siteLabel) return str('imd-compute');
  }
  if (to === uni.quoter.toLowerCase() && sel === SEL.quote) {
    if (state.revertOn === 'quote') revert('PoolNotInitialized');
    return encodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', result: [state.quoteOut, 87_000n] });
  }
  if (to === uni.stateView.toLowerCase()) {
    if (sel === SEL.getSlot0) return encodeFunctionResult({ abi: stateViewAbi, functionName: 'getSlot0', result: [state.sqrtPriceX96, 177_284, 0, 3000] });
    if (sel === SEL.getLiquidity) return encodeFunctionResult({ abi: stateViewAbi, functionName: 'getLiquidity', result: state.liquidity });
  }
  if (to === uni.permit2.toLowerCase()) {
    if (sel === SEL.permitAllowance) {
      const { args } = decodeFunctionData({ abi: permit2Abi, data }) as unknown as { args: [string, string, string] };
      const a = state.permitAllowances[`${args[0].toLowerCase()}:${args[1].toLowerCase()}:${args[2].toLowerCase()}`] ?? { amount: 0n, expiration: 0 };
      return encodeFunctionResult({ abi: permit2Abi, functionName: 'allowance', result: [a.amount, a.expiration, 0] });
    }
    if (sel === SEL.permitApprove) return '0x';
  }
  if (to === uni.universalRouter.toLowerCase() && sel === SEL.execute) {
    if (state.revertOn === 'execute') revert('V4TooLittleReceived');
    return '0x';
  }
  throw Object.assign(new Error(`fake chain: unhandled call to ${to} ${sel}`), { code: -32000 });
}

/** Mirror the state changes a mined approve / Permit2 approve would produce. */
function applyTxEffects(state: FakeChainState, tx: { to: string; from?: string; data: Hex }) {
  const to = tx.to.toLowerCase();
  const from = (tx.from ?? ACCOUNT).toLowerCase();
  const sel = tx.data.slice(0, 10);
  const uni = MANIFEST.network!.uniswapV4!;
  if (to === TOKEN.address.toLowerCase() && sel === SEL.approve) {
    const { args } = decodeFunctionData({ abi: seatComputeAbi as never, data: tx.data }) as unknown as { args: [string, bigint] };
    state.allowances[`${from}:${args[0].toLowerCase()}`] = args[1];
  }
  if (to === uni.permit2.toLowerCase() && sel === SEL.permitApprove) {
    const { args } = decodeFunctionData({ abi: permit2Abi, data: tx.data }) as unknown as { args: [string, string, bigint, number] };
    state.permitAllowances[`${from}:${args[0].toLowerCase()}:${args[1].toLowerCase()}`] = { amount: args[2], expiration: Number(args[3]) };
  }
}

/** Pure JSON-RPC method handler over the fake chain state (throws on error). */
export function handleRpc(state: FakeChainState, method: string, p: unknown[]): unknown {
  switch (method) {
    case 'eth_chainId':
      return toHex(state.chainId);
    case 'eth_getCode':
      return state.code[String(p[0]).toLowerCase()] ?? '0x';
    case 'eth_getBalance':
      return toHex(state.balances[String(p[0]).toLowerCase()] ?? 0n);
    case 'eth_call':
      return ethCall(state, p[0] as never);
    case 'eth_estimateGas':
      return '0x5208';
    case 'eth_blockNumber':
      return '0x10';
    case 'eth_gasPrice':
      return '0x1';
    case 'eth_maxPriorityFeePerGas':
      return '0x1';
    case 'eth_getTransactionCount':
      return '0x1';
    case 'eth_getBlockByNumber':
      return { number: '0x10', baseFeePerGas: '0x1', hash: '0x' + '11'.repeat(32), timestamp: '0x1', transactions: [] };
    case 'eth_sendTransaction': {
      const tx = p[0] as { to: string; from?: string; data: Hex; value?: Hex };
      state.txs.push({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
      applyTxEffects(state, tx);
      return '0x' + 'ab'.repeat(32);
    }
    case 'eth_getTransactionReceipt':
      return {
        transactionHash: p[0],
        status: '0x1',
        blockNumber: '0x11',
        blockHash: '0x' + '22'.repeat(32),
        transactionIndex: '0x0',
        from: ACCOUNT,
        to: TOKEN.address,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        effectiveGasPrice: '0x1',
        type: '0x2',
      };
    default:
      throw Object.assign(new Error(`unsupported ${method}`), { code: -32601 });
  }
}

/** JSON-RPC handler usable as a global fetch for viem http transports. */
export function fakeRpcFetch(state: FakeChainState, passthrough?: typeof fetch): typeof fetch {
  const handle = (req: { id: number; method: string; params?: unknown[] }) => {
    try {
      return { jsonrpc: '2.0', id: req.id, result: handleRpc(state, req.method, req.params ?? []) };
    } catch (e) {
      const err = e as { code?: number; message: string; data?: Hex };
      return { jsonrpc: '2.0', id: req.id, error: { code: err.code ?? -32000, message: err.message, data: err.data } };
    }
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (init?.method === 'POST' && typeof init.body === 'string' && init.body.includes('jsonrpc')) {
      const body = JSON.parse(init.body) as { id: number; method: string; params?: unknown[] } | { id: number; method: string; params?: unknown[] }[];
      const out = Array.isArray(body) ? body.map(handle) : handle(body);
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (passthrough) return passthrough(input, init);
    return new Response('not found', { status: 404, statusText: url });
  }) as typeof fetch;
}
