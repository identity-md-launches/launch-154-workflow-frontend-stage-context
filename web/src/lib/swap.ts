import type { Address, Hex } from 'viem';
import { encodeAbiParameters, keccak256, zeroAddress } from 'viem';
import { POOL_KEY_COMPONENTS } from './uniswapAbi';

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface PoolSpec {
  pairedCurrency: Address; // zero address for native ETH
  fee: number;
  tickSpacing: number;
  hooks: Address; // zero address for a hookless pool
}

/** Pool parameters from the attested manifest for this launch (native ETH / COMPUTE, 0.30 %, no hook). */
export const LAUNCH_POOL: PoolSpec = {
  pairedCurrency: zeroAddress,
  fee: 3000,
  tickSpacing: 60,
  hooks: zeroAddress,
};

/** Build the v4 PoolKey: currencies sorted ascending (native ETH is the zero address and sorts first). */
export function buildPoolKey(token: Address, spec: PoolSpec = LAUNCH_POOL): PoolKey {
  const a = spec.pairedCurrency.toLowerCase() as Address;
  const b = token.toLowerCase() as Address;
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { currency0, currency1, fee: spec.fee, tickSpacing: spec.tickSpacing, hooks: spec.hooks.toLowerCase() as Address };
}

export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'tuple', components: POOL_KEY_COMPONENTS }],
      [{ currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks }],
    ),
  );
}

/** Universal Router command and v4 action bytes. */
export const V4_SWAP_COMMAND: Hex = '0x10';
export const V4_ACTIONS_EXACT_IN_SINGLE: Hex = '0x060c0f'; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

export interface SwapPlan {
  poolKey: PoolKey;
  zeroForOne: boolean;
  inputCurrency: Address;
  outputCurrency: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  nativeIn: boolean;
}

export function planSwap(key: PoolKey, inputCurrency: Address, amountIn: bigint, amountOutMinimum: bigint): SwapPlan {
  const input = inputCurrency.toLowerCase() as Address;
  const zeroForOne = input === key.currency0;
  if (!zeroForOne && input !== key.currency1) throw new Error('input currency is not part of the pool');
  return {
    poolKey: key,
    zeroForOne,
    inputCurrency: input,
    outputCurrency: zeroForOne ? key.currency1 : key.currency0,
    amountIn,
    amountOutMinimum,
    nativeIn: input === zeroAddress,
  };
}

export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** ABI-encode the `inputs[0]` payload for a V4_SWAP exact-input single-hop swap. */
export function encodeV4SwapInput(plan: SwapPlan): Hex {
  const params0 = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: POOL_KEY_COMPONENTS },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [
      {
        poolKey: plan.poolKey,
        zeroForOne: plan.zeroForOne,
        amountIn: plan.amountIn,
        amountOutMinimum: plan.amountOutMinimum,
        hookData: '0x',
      },
    ],
  );
  const params1 = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [plan.inputCurrency, plan.amountIn]);
  const params2 = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [plan.outputCurrency, plan.amountOutMinimum]);
  return encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [V4_ACTIONS_EXACT_IN_SINGLE, [params0, params1, params2]]);
}

/** Arguments for `UniversalRouter.execute(bytes commands, bytes[] inputs, uint256 deadline)`. */
export function buildExecuteArgs(plan: SwapPlan, deadline: bigint): { args: readonly [Hex, readonly Hex[], bigint]; value: bigint } {
  return {
    args: [V4_SWAP_COMMAND, [encodeV4SwapInput(plan)], deadline] as const,
    value: plan.nativeIn ? plan.amountIn : 0n,
  };
}

const Q96 = 2n ** 96n;

/**
 * Price of currency1 in currency0 terms (and inverse) from sqrtPriceX96, as decimal strings with
 * the given token decimals. Uses integer math with 18 extra digits of precision.
 */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): { token1PerToken0: number; token0PerToken1: number } {
  if (sqrtPriceX96 === 0n) return { token1PerToken0: 0, token0PerToken1: 0 };
  // price1per0 = (sqrt/Q96)^2 * 10^(d0 - d1)
  const scale = 10n ** 18n;
  const ratio = (sqrtPriceX96 * sqrtPriceX96 * scale) / (Q96 * Q96); // price * 1e18 in raw units
  const adj = 10n ** BigInt(Math.abs(decimals0 - decimals1));
  const token1PerToken0Raw = decimals0 >= decimals1 ? ratio * adj : ratio / adj;
  const token1PerToken0 = Number(token1PerToken0Raw) / 1e18;
  return { token1PerToken0, token0PerToken1: token1PerToken0 === 0 ? 0 : 1 / token1PerToken0 };
}
