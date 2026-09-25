import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';
import {
  applyFilters,
  DEFAULT_FILTERS,
  filtersFromHash,
  filtersToHash,
  linkedRowKeys,
  loadDashboard,
  runtimeOptions,
  type DashboardData,
  type DashboardFilters,
  type SeatRow,
  type SortKey,
} from '../lib/dashboard';
import { fmtCompact, fmtDateTime, fmtDuration, fmtInt, fmtRelative, shortAddress } from '../lib/format';
import { MAINNET_SEAT_LOOKUP, ONLINE_THRESHOLD_MS } from '../config';
import { erc721OwnerOfAbi } from '../lib/uniswapAbi';
import type { Deployment } from '../lib/deployment';

interface Props {
  account: string | null;
  onLinkedCount: (n: number) => void;
  deployment: Deployment | null;
}

const PAGE_SIZES = [50, 100, 250, 1000] as const;

interface Column {
  key: SortKey;
  label: string;
  numeric: boolean;
  title?: string;
}

const COLUMNS: Column[] = [
  { key: 'tokenId', label: 'Seat', numeric: false },
  { key: 'wallet', label: 'Wallet', numeric: false },
  { key: 'lastHeartbeatAt', label: 'Heartbeat', numeric: false },
  { key: 'daemonVersion', label: 'Daemon', numeric: false },
  { key: 'accepted', label: 'Accepted', numeric: true },
  { key: 'rejected', label: 'Rejected', numeric: true },
  { key: 'pending', label: 'Pending', numeric: true },
  { key: 'attempts', label: 'Attempts', numeric: true },
  { key: 'outputTokens', label: 'Output Tokens', numeric: true },
  { key: 'inputTokens', label: 'Input Tokens', numeric: true },
  { key: 'cachedInputTokens', label: 'Cached Input', numeric: true },
  { key: 'turns', label: 'Turns', numeric: true },
  { key: 'wallClockMs', label: 'Wall Clock', numeric: true },
];

export function Dashboard({ account, onLinkedCount, deployment }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<DashboardFilters>(() =>
    typeof window !== 'undefined' ? filtersFromHash(window.location.hash) : DEFAULT_FILTERS,
  );
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  const [mainnetOwners, setMainnetOwners] = useState<Record<string, string>>({});
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const d = await loadDashboard();
      if (id !== requestId.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the URL hash in sync so filtered views are deep-linkable.
  useEffect(() => {
    const next = filtersToHash(filters);
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [filters]);
  useEffect(() => {
    const onHash = () => setFilters(filtersFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Optional, non-blocking: rows with no wallet get a read-only mainnet ownerOf lookup.
  const missingIds = useMemo(
    () => (data ? data.rows.filter((r) => r.walletMissing && /^\d+$/.test(r.tokenId)).map((r) => r.tokenId).slice(0, MAINNET_SEAT_LOOKUP.maxLookups) : []),
    [data],
  );
  useEffect(() => {
    if (missingIds.length === 0) return;
    let cancelled = false;
    const client = createPublicClient({
      chain: mainnet,
      transport: fallback(MAINNET_SEAT_LOOKUP.rpcUrls.map((u) => http(u, { timeout: 10_000, retryCount: 0 }))),
      batch: { multicall: true },
    });
    Promise.allSettled(
      missingIds.map((id) =>
        client
          .readContract({ address: MAINNET_SEAT_LOOKUP.collection as Address, abi: erc721OwnerOfAbi, functionName: 'ownerOf', args: [BigInt(id)] })
          .then((owner) => [id, owner.toLowerCase()] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      const found: Record<string, string> = {};
      for (const r of results) if (r.status === 'fulfilled') found[r.value[0]] = r.value[1];
      if (Object.keys(found).length) setMainnetOwners((prev) => ({ ...prev, ...found }));
    });
    return () => {
      cancelled = true;
    };
  }, [missingIds]);

  const rows: SeatRow[] = useMemo(() => {
    if (!data) return [];
    if (Object.keys(mainnetOwners).length === 0) return data.rows;
    return data.rows.map((r) => (r.walletMissing && mainnetOwners[r.tokenId] ? { ...r, wallet: mainnetOwners[r.tokenId] ?? '' } : r));
  }, [data, mainnetOwners]);

  const linked = useMemo(() => linkedRowKeys(rows, account), [rows, account]);
  useEffect(() => onLinkedCount(linked.size), [linked, onLinkedCount]);

  const visible = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const runtimes = useMemo(() => runtimeOptions(rows), [rows]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const update = (patch: Partial<DashboardFilters>) => {
    setPage(0);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const toggleSort = (key: SortKey, numeric: boolean) => {
    setPage(0);
    setFilters((f) => (f.sort === key ? { ...f, dir: f.dir === 'desc' ? 'asc' : 'desc' } : { ...f, sort: key, dir: numeric || key === 'lastHeartbeatAt' ? 'desc' : 'asc' }));
  };

  const totals = useMemo(() => {
    const online = rows.filter((r) => r.online).length;
    const output = rows.reduce((s, r) => s + r.outputTokens, 0);
    const accepted = rows.reduce((s, r) => s + r.accepted, 0);
    return { seats: rows.length, online, output, accepted };
  }, [rows]);

  return (
    <section className="card" aria-labelledby="dashboard-h">
      <div className="card-head">
        <h2 id="dashboard-h">Seat Compute Dashboard</h2>
        <div className="asof" aria-live="polite">
          {data && (
            <span className="muted small">
              {data.source === 'snapshot' ? 'Snapshot as of ' : 'As of '}
              <time dateTime={data.asOf.toISOString()}>{fmtDateTime(data.asOf)}</time>
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={loading} aria-label="Refresh dashboard data">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="disclaimer">
        Counters are <strong>plane-reported, not audited billing</strong>. They come from the public api.imd.fun contributors and
        workers endpoints and can lag or be revised. Online means a heartbeat within the last {Math.round(ONLINE_THRESHOLD_MS / 60000)}
        &nbsp;minutes.
      </p>

      {data?.warning && (
        <p className="notice" role="status">
          {data.warning}
        </p>
      )}
      {error && !data && (
        <p className="inline-error" role="alert">
          {error} — check your connection or that the API allows browser requests, then press Refresh.
        </p>
      )}
      {error && data && (
        <p className="inline-error" role="alert">
          Refresh failed: {error}. Showing the previous data.
        </p>
      )}

      {data && (
        <div className="stats" role="list" aria-label="Totals">
          <Stat label="Seats" value={fmtInt(totals.seats)} />
          <Stat label="Online" value={fmtInt(totals.online)} />
          <Stat label="Accepted Jobs" value={fmtInt(totals.accepted)} />
          <Stat label="Output Tokens" value={fmtCompact(totals.output)} title={fmtInt(totals.output)} />
          {data.tokensPerCompletedJob !== null && <Stat label="Tokens / Completed Job" value={fmtInt(data.tokensPerCompletedJob)} />}
          {account && <Stat label="Seats Linked" value={fmtInt(linked.size)} highlight />}
        </div>
      )}

      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Dashboard filters">
        <label className="field">
          <span>Search seat or wallet</span>
          <input
            type="search"
            name="q"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
            placeholder="e.g. 88 or 0xb376…"
            autoComplete="off"
            spellCheck={false}
            inputMode="search"
          />
        </label>
        <label className="field">
          <span>Runtime</span>
          <select name="runtime" value={filters.runtime} onChange={(e) => update({ runtime: e.target.value })}>
            <option value="">Any runtime</option>
            {runtimes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Min accepted</span>
          <input
            type="number"
            name="minAccepted"
            min={0}
            step={1}
            inputMode="numeric"
            autoComplete="off"
            value={filters.minAccepted || ''}
            onChange={(e) => update({ minAccepted: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            placeholder="0"
          />
        </label>
        <label className="field field-check">
          <input type="checkbox" name="online" checked={filters.onlineOnly} onChange={(e) => update({ onlineOnly: e.target.checked })} />
          <span>Online only</span>
        </label>
        <label className="field">
          <span>Rows per page</span>
          <select
            name="pageSize"
            value={pageSize}
            onChange={(e) => {
              setPage(0);
              setPageSize(Number(e.target.value));
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {(filters.query || filters.runtime || filters.minAccepted > 0 || filters.onlineOnly) && (
          <button type="button" className="btn btn-ghost" onClick={() => update({ query: '', runtime: '', minAccepted: 0, onlineOnly: false })}>
            Clear Filters
          </button>
        )}
      </form>

      <p className="muted small" aria-live="polite">
        {data ? `${fmtInt(visible.length)} of ${fmtInt(rows.length)} seats` : loading ? 'Loading seats…' : 'No data'}
        {account && linked.size > 0 && ' · highlighted rows belong to the connected wallet'}
      </p>

      <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="dashboard-h">
        <table className="seat-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = filters.sort === c.key;
                return (
                  <th key={c.key} scope="col" className={c.numeric ? 'num' : ''} aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sort-btn" onClick={() => toggleSort(c.key, c.numeric)} title={c.title}>
                      {c.label}
                      <span className="sort-ind" aria-hidden="true">
                        {active ? (filters.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col">Runtimes</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data && visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="muted">
                  No seats match these filters. Clear a filter or change the search.
                </td>
              </tr>
            )}
            {pageRows.map((r) => {
              const isLinked = linked.has(r.key);
              return (
                <tr key={r.key} className={isLinked ? 'row-linked' : ''} data-linked={isLinked ? 'true' : undefined} data-testid="seat-row">
                  <td translate="no">
                    <span className={`dot ${r.online ? 'dot-on' : r.hasWorker ? 'dot-off' : 'dot-none'}`} aria-hidden="true" />
                    <span className="visually-hidden">{r.online ? 'online ' : r.hasWorker ? 'offline ' : 'no worker '}</span>
                    {r.tokenId || '—'}
                    {isLinked && <span className="tag">yours</span>}
                    {r.working && (
                      <span className="tag tag-work" title="Currently working">
                        busy
                      </span>
                    )}
                  </td>
                  <td className="mono" translate="no" title={r.wallet || 'wallet not reported'}>
                    {r.wallet ? shortAddress(r.wallet) : <span className="muted">—</span>}
                  </td>
                  <td title={r.lastHeartbeatAt ? fmtDateTime(r.lastHeartbeatAt) : 'no heartbeat'}>
                    {r.lastHeartbeatAt ? fmtRelative(r.lastHeartbeatAt) : <span className="muted">—</span>}
                  </td>
                  <td className="mono" translate="no">
                    {r.daemonVersion ?? <span className="muted">—</span>}
                  </td>
                  <td className="num">{fmtInt(r.accepted)}</td>
                  <td className="num">{fmtInt(r.rejected)}</td>
                  <td className="num">{fmtInt(r.pending)}</td>
                  <td className="num">{fmtInt(r.attempts)}</td>
                  <td className="num" title={fmtInt(r.outputTokens)}>
                    {fmtCompact(r.outputTokens)}
                  </td>
                  <td className="num" title={fmtInt(r.inputTokens)}>
                    {fmtCompact(r.inputTokens)}
                  </td>
                  <td className="num" title={fmtInt(r.cachedInputTokens)}>
                    {fmtCompact(r.cachedInputTokens)}
                  </td>
                  <td className="num">{fmtInt(r.turns)}</td>
                  <td className="num">{fmtDuration(r.wallClockMs)}</td>
                  <td>{r.runtimes.length ? r.runtimes.join(', ') : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <nav className="pager" aria-label="Table pages">
          <button type="button" className="btn btn-ghost" onClick={() => setPage(0)} disabled={safePage === 0}>
            First
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
            Previous
          </button>
          <span className="muted small">
            Page {safePage + 1} of {pageCount}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}>
            Next
          </button>
        </nav>
      )}

      {deployment && !deployment.network && (
        <p className="muted small">The launch chain is not in the vetted network table; only reads are available.</p>
      )}
    </section>
  );
}

function Stat({ label, value, title, highlight }: { label: string; value: string; title?: string; highlight?: boolean }) {
  return (
    <div className={`stat ${highlight ? 'stat-hl' : ''}`} role="listitem" title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">{value}</span>
    </div>
  );
}
