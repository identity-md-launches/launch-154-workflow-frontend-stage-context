import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, zeroAddress, type Hex } from 'viem';
import { applySlippage, buildExecuteArgs, buildPoolKey, encodeV4SwapInput, planSwap, poolId, priceFromSqrtX96, V4_ACTIONS_EXACT_IN_SINGLE, V4_SWAP_COMMAND } from './swap';
import { POOL_KEY_COMPONENTS } from './uniswapAbi';
import { TOKEN } from '../test/fixtures';

const token = TOKEN.address as `0x${string}`;

describe('pool key', () => {
  it('puts native ETH first and uses the manifest pool parameters', () => {
    const key = buildPoolKey(token);
    expect(key).toEqual({ currency0: zeroAddress, currency1: token.toLowerCase(), fee: 3000, tickSpacing: 60, hooks: zeroAddress });
  });

  it('sorts non-native currencies ascending', () => {
    const key = buildPoolKey('0x0000000000000000000000000000000000000002', { pairedCurrency: '0x0000000000000000000000000000000000000009', fee: 500, tickSpacing: 10, hooks: zeroAddress });
    expect(key.currency0).toBe('0x0000000000000000000000000000000000000002');
    expect(key.currency1).toBe('0x0000000000000000000000000000000000000009');
  });

  it('derives the same pool id as cast keccak(abi.encode(poolKey))', () => {
    // computed with: cast keccak $(cast abi-encode "f(address,address,uint24,int24,address)" 0x0 <token> 3000 60 0x0)
    expect(poolId(buildPoolKey(token))).toBe('0x3008533309f3bcf462933cb2697bcb8de63bbb1585fe3e495b2c3fedb8b4a432');
  });
});

describe('swap encoding', () => {
  const key = buildPoolKey(token);

  it('encodes ETH → token as zeroForOne with value = amountIn', () => {
    const plan = planSwap(key, zeroAddress, 10n ** 15n, 42n);
    expect(plan.zeroForOne).toBe(true);
    expect(plan.nativeIn).toBe(true);
    const { args, value } = buildExecuteArgs(plan, 123n);
    expect(args[0]).toBe(V4_SWAP_COMMAND);
    expect(args[2]).toBe(123n);
    expect(value).toBe(10n ** 15n);

    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], args[1][0] as Hex);
    expect(actions).toBe(V4_ACTIONS_EXACT_IN_SINGLE);
    expect(params).toHaveLength(3);
    const [p0] = decodeAbiParameters(
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
      params[0]!,
    );
    expect(p0.poolKey.currency1.toLowerCase()).toBe(token.toLowerCase());
    expect(p0.zeroForOne).toBe(true);
    expect(p0.amountIn).toBe(10n ** 15n);
    expect(p0.amountOutMinimum).toBe(42n);
    expect(p0.hookData).toBe('0x');
    const [settleCurrency, settleAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!);
    expect(settleCurrency).toBe(zeroAddress);
    expect(settleAmount).toBe(10n ** 15n);
    const [takeCurrency, takeMin] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]!);
    expect(takeCurrency.toLowerCase()).toBe(token.toLowerCase());
    expect(takeMin).toBe(42n);
  });

  it('encodes token → ETH as oneForZero with no value', () => {
    const plan = planSwap(key, token, 5n, 1n);
    expect(plan.zeroForOne).toBe(false);
    expect(plan.outputCurrency).toBe(zeroAddress);
    expect(buildExecuteArgs(plan, 1n).value).toBe(0n);
    expect(encodeV4SwapInput(plan)).toMatch(/^0x/);
  });

  it('rejects an input currency outside the pool', () => {
    expect(() => planSwap(key, '0x1111111111111111111111111111111111111111', 1n, 0n)).toThrow(/not part of the pool/);
  });
});

describe('math helpers', () => {
  it('applies slippage in basis points and clamps', () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 99_999)).toBe(0n);
  });

  it('converts sqrtPriceX96 to a human price', () => {
    // Live Sepolia slot0 at build time: ≈ 5.0e7 COMPUTE per ETH
    const p = priceFromSqrtX96(560227709747861399187319382274582n, 18, 18);
    expect(p.token1PerToken0).toBeGreaterThan(4.9e7);
    expect(p.token1PerToken0).toBeLessThan(5.1e7);
    expect(p.token0PerToken1).toBeCloseTo(1 / p.token1PerToken0, 12);
    expect(priceFromSqrtX96(0n, 18, 18)).toEqual({ token1PerToken0: 0, token0PerToken1: 0 });
  });
});
