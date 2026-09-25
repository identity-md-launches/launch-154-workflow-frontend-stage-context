import { describe, expect, it } from 'vitest';
import { applyFilters, DEFAULT_FILTERS, filtersFromHash, filtersToHash, joinRows, linkedRowKeys, loadDashboard, runtimeOptions } from './dashboard';
import { ACCOUNT, NOW, contributors, workers, mockFetch } from '../test/fixtures';

describe('joinRows', () => {
  const rows = joinRows(contributors.contributors!, workers.workers!, NOW);

  it('lists every contributor even without a worker', () => {
    expect(rows).toHaveLength(4);
    const orphan = rows.find((r) => r.tokenId === '9001')!;
    expect(orphan.hasWorker).toBe(false);
    expect(orphan.online).toBe(false);
    expect(orphan.walletMissing).toBe(true);
  });

  it('joins by deviceKey first, then by seat.tokenId string', () => {
    expect(rows.find((r) => r.tokenId === '88')!.daemonVersion).toBe('0.1.0+aaaa');
    // dev-b has no deviceKey match; it joins by seat tokenId 1199
    expect(rows.find((r) => r.tokenId === '1199')!.daemonVersion).toBe('0.1.0+bbbb');
  });

  it('computes online status from lastHeartbeatAt and normalises counters', () => {
    const a = rows.find((r) => r.tokenId === '88')!;
    expect(a.online).toBe(true);
    expect(a.working).toBe(true);
    expect(a.outputTokens).toBe(5000);
    expect(a.wallClockMs).toBe(3_600_000);
    expect(rows.find((r) => r.tokenId === '1199')!.online).toBe(false);
  });

  it('lowercases wallets', () => {
    expect(rows.find((r) => r.tokenId === '1199')!.wallet).toBe('0xb3763a57618a8842d5b5664651ea7b8ef6334329');
  });
});

describe('filters and sorting', () => {
  const rows = joinRows(contributors.contributors!, workers.workers!, NOW);

  it('defaults to outputTokens descending', () => {
    const sorted = applyFilters(rows, DEFAULT_FILTERS);
    expect(sorted.map((r) => r.tokenId)).toEqual(['7', '88', '1199', '9001']);
  });

  it('filters online, runtime, min accepted and search', () => {
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, onlineOnly: true }).map((r) => r.tokenId)).toEqual(['7', '88']);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, runtime: 'codex' }).map((r) => r.tokenId)).toEqual(['7', '1199']);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, minAccepted: 5 }).map((r) => r.tokenId)).toEqual(['7', '88']);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, query: '0x2222' }).map((r) => r.tokenId)).toEqual(['7']);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, query: '119' }).map((r) => r.tokenId)).toEqual(['1199']);
  });

  it('sorts tokenId numerically and strings alphabetically', () => {
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, sort: 'tokenId', dir: 'asc' }).map((r) => r.tokenId)).toEqual(['7', '88', '1199', '9001']);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, sort: 'daemonVersion', dir: 'asc' })[0]!.daemonVersion).toBeNull();
  });

  it('exposes runtime options', () => {
    expect(runtimeOptions(rows)).toEqual(['claude', 'codex']);
  });

  it('round-trips filters through the URL hash', () => {
    const f = { ...DEFAULT_FILTERS, query: 'abc', onlineOnly: true, runtime: 'claude', minAccepted: 3, sort: 'accepted' as const, dir: 'asc' as const };
    expect(filtersFromHash(filtersToHash(f))).toEqual(f);
    expect(filtersToHash(DEFAULT_FILTERS)).toBe('#/');
    expect(filtersFromHash('#/?sort=bogus&dir=sideways&minAccepted=-4')).toEqual(DEFAULT_FILTERS);
  });
});

describe('linkedRowKeys', () => {
  it('matches every row whose wallet equals the connected address, case-insensitively', () => {
    const rows = joinRows(contributors.contributors!, workers.workers!, NOW);
    const linked = linkedRowKeys(rows, ACCOUNT);
    expect(linked.size).toBe(2);
    expect(linkedRowKeys(rows, null).size).toBe(0);
    expect(linkedRowKeys(rows, '0x9999999999999999999999999999999999999999').size).toBe(0);
  });
});

describe('loadDashboard', () => {
  it('uses the live APIs when they respond', async () => {
    const d = await loadDashboard({ fetchImpl: mockFetch({ contributors, workers }), now: () => NOW, snapshotUrl: null });
    expect(d.source).toBe('live');
    expect(d.rows).toHaveLength(4);
    expect(d.receipts).toBe(10);
    expect(d.workerCount).toBe(3);
  });

  it('falls back to the bundled snapshot when the live API fails (e.g. CORS)', async () => {
    const snapshot = { capturedAt: '2026-09-25T06:00:00.000Z', contributors, workers };
    const f = mockFetch({ 'data/snapshot.json': snapshot }, ['api.imd.fun']);
    const d = await loadDashboard({ fetchImpl: f, now: () => NOW });
    expect(d.source).toBe('snapshot');
    expect(d.asOf.toISOString()).toBe('2026-09-25T06:00:00.000Z');
    expect(d.warning).toMatch(/Live API unavailable/);
  });

  it('throws when neither live API nor snapshot is available', async () => {
    await expect(loadDashboard({ fetchImpl: mockFetch({}, ['api.imd.fun']), now: () => NOW })).rejects.toThrow(/api.imd.fun/);
  });

  it('rejects malformed responses', async () => {
    await expect(loadDashboard({ fetchImpl: mockFetch({ contributors: { nope: 1 }, workers }), snapshotUrl: null })).rejects.toThrow(/contributors/);
  });
});
