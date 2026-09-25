import { API, ONLINE_THRESHOLD_MS } from '../config';
import { toNumber } from './format';

/** Raw shapes from https://api.imd.fun (only the fields the dashboard uses). */
export interface ContributorRecord {
  deviceKey?: string;
  wallet?: string | null;
  tokenId: string | number;
  attempts?: number | string;
  accepted?: number | string;
  rejected?: number | string;
  pending?: number | string;
  wallClockMs?: number | string;
  inputTokens?: number | string;
  outputTokens?: number | string;
  cachedInputTokens?: number | string;
  turns?: number | string;
}

export interface WorkerRuntime {
  id?: string;
  version?: string;
}

export interface WorkerRecord {
  deviceKey?: string;
  seat?: { tokenId?: string | number; agentId?: string | number } | null;
  daemonVersion?: string;
  lastHeartbeatAt?: string | null;
  working?: number | boolean;
  runtimes?: WorkerRuntime[] | null;
}

export interface ContributorsResponse {
  contributors?: ContributorRecord[];
  receipts?: number;
  tokensPerCompletedJob?: number;
}

export interface WorkersResponse {
  workers?: WorkerRecord[];
  count?: number;
}

/** One dashboard row: a contributor joined with its worker (if any). */
export interface SeatRow {
  key: string;
  tokenId: string;
  wallet: string; // lowercase, '' when missing
  walletMissing: boolean;
  attempts: number;
  accepted: number;
  rejected: number;
  pending: number;
  wallClockMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  turns: number;
  daemonVersion: string | null;
  lastHeartbeatAt: string | null;
  working: boolean;
  runtimes: string[];
  online: boolean;
  hasWorker: boolean;
}

export type SortKey =
  | 'tokenId'
  | 'wallet'
  | 'attempts'
  | 'accepted'
  | 'rejected'
  | 'pending'
  | 'wallClockMs'
  | 'inputTokens'
  | 'outputTokens'
  | 'cachedInputTokens'
  | 'turns'
  | 'lastHeartbeatAt'
  | 'daemonVersion';

export interface DashboardFilters {
  query: string;
  onlineOnly: boolean;
  runtime: string; // '' = any
  minAccepted: number;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: DashboardFilters = {
  query: '',
  onlineOnly: false,
  runtime: '',
  minAccepted: 0,
  sort: 'outputTokens',
  dir: 'desc',
};

export const NUMERIC_SORT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  'attempts',
  'accepted',
  'rejected',
  'pending',
  'wallClockMs',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'turns',
]);

export function seatKey(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function isOnline(lastHeartbeatAt: string | null | undefined, now: number, threshold = ONLINE_THRESHOLD_MS): boolean {
  if (!lastHeartbeatAt) return false;
  const t = new Date(lastHeartbeatAt).getTime();
  return Number.isFinite(t) && now - t <= threshold;
}

/**
 * Join contributors to workers. Workers are matched by deviceKey when both sides carry one,
 * otherwise by the string form of seat.tokenId. A contributor without a worker is still listed.
 */
export function joinRows(contributors: ContributorRecord[], workers: WorkerRecord[], now = Date.now()): SeatRow[] {
  const byDevice = new Map<string, WorkerRecord>();
  const bySeat = new Map<string, WorkerRecord>();
  for (const w of workers) {
    if (w.deviceKey) byDevice.set(w.deviceKey, w);
    const seat = seatKey(w.seat?.tokenId);
    if (seat && !bySeat.has(seat)) bySeat.set(seat, w);
  }
  return contributors.map((c, index) => {
    const tokenId = seatKey(c.tokenId);
    const worker = (c.deviceKey && byDevice.get(c.deviceKey)) || bySeat.get(tokenId) || null;
    const wallet = typeof c.wallet === 'string' ? c.wallet.trim().toLowerCase() : '';
    const runtimes = (worker?.runtimes ?? [])
      .map((r) => (r && typeof r.id === 'string' ? r.id : ''))
      .filter((id) => id !== '');
    return {
      key: c.deviceKey ? `d:${c.deviceKey}` : `t:${tokenId}:${index}`,
      tokenId,
      wallet,
      walletMissing: wallet === '',
      attempts: toNumber(c.attempts),
      accepted: toNumber(c.accepted),
      rejected: toNumber(c.rejected),
      pending: toNumber(c.pending),
      wallClockMs: toNumber(c.wallClockMs),
      inputTokens: toNumber(c.inputTokens),
      outputTokens: toNumber(c.outputTokens),
      cachedInputTokens: toNumber(c.cachedInputTokens),
      turns: toNumber(c.turns),
      daemonVersion: worker?.daemonVersion ?? null,
      lastHeartbeatAt: worker?.lastHeartbeatAt ?? null,
      working: Boolean(worker && toNumber(worker.working) > 0) || worker?.working === true,
      runtimes: Array.from(new Set(runtimes)),
      online: isOnline(worker?.lastHeartbeatAt, now),
      hasWorker: worker !== null,
    };
  });
}

export function applyFilters(rows: SeatRow[], f: DashboardFilters): SeatRow[] {
  const q = f.query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (f.onlineOnly && !r.online) return false;
    if (f.runtime && !r.runtimes.includes(f.runtime)) return false;
    if (f.minAccepted > 0 && r.accepted < f.minAccepted) return false;
    if (q && !r.tokenId.toLowerCase().includes(q) && !r.wallet.includes(q)) return false;
    return true;
  });
  return sortRows(filtered, f.sort, f.dir);
}

export function sortRows(rows: SeatRow[], sort: SortKey, dir: 'asc' | 'desc'): SeatRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const copy = rows.slice();
  copy.sort((a, b) => {
    let cmp = 0;
    if (NUMERIC_SORT_KEYS.has(sort)) {
      cmp = (a[sort] as number) - (b[sort] as number);
    } else if (sort === 'tokenId') {
      const an = Number(a.tokenId);
      const bn = Number(b.tokenId);
      cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : a.tokenId.localeCompare(b.tokenId);
    } else if (sort === 'lastHeartbeatAt') {
      cmp = (a.lastHeartbeatAt ? Date.parse(a.lastHeartbeatAt) : 0) - (b.lastHeartbeatAt ? Date.parse(b.lastHeartbeatAt) : 0);
    } else {
      cmp = String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''));
    }
    if (cmp === 0) cmp = a.tokenId.localeCompare(b.tokenId, undefined, { numeric: true });
    return cmp * sign;
  });
  return copy;
}

export function runtimeOptions(rows: SeatRow[]): string[] {
  return Array.from(new Set(rows.flatMap((r) => r.runtimes))).sort();
}

/** Rows whose wallet equals the connected address (both lowercased). */
export function linkedRowKeys(rows: SeatRow[], account: string | null): Set<string> {
  const out = new Set<string>();
  if (!account) return out;
  const a = account.toLowerCase();
  for (const r of rows) if (r.wallet && r.wallet === a) out.add(r.key);
  return out;
}

export interface DashboardData {
  rows: SeatRow[];
  asOf: Date;
  source: 'live' | 'snapshot';
  receipts: number | null;
  tokensPerCompletedJob: number | null;
  workerCount: number;
  warning: string | null;
}

export interface SnapshotFile {
  capturedAt: string;
  contributors: ContributorsResponse;
  workers: WorkersResponse;
}

async function fetchWithTimeout(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  snapshotUrl?: string | null;
  contributorsUrl?: string;
  workersUrl?: string;
}

/**
 * Load the live APIs; if either request fails (network, CORS, non-2xx, malformed JSON) fall back
 * to the bundled snapshot when one exists, marking the data source so the UI can say so.
 */
export async function loadDashboard(opts: FetchOptions = {}): Promise<DashboardData> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const contributorsUrl = opts.contributorsUrl ?? API.contributors;
  const workersUrl = opts.workersUrl ?? API.workers;
  let liveError: string | null = null;
  try {
    const [cRes, wRes] = await Promise.all([
      fetchWithTimeout(contributorsUrl, fetchImpl, API.timeoutMs),
      fetchWithTimeout(workersUrl, fetchImpl, API.timeoutMs),
    ]);
    if (!cRes.ok) throw new Error(`contributors HTTP ${cRes.status}`);
    if (!wRes.ok) throw new Error(`workers HTTP ${wRes.status}`);
    const c = (await cRes.json()) as ContributorsResponse | ContributorRecord[];
    const w = (await wRes.json()) as WorkersResponse | WorkerRecord[];
    return build(c, w, new Date(now()), 'live', null, now());
  } catch (err) {
    liveError = err instanceof Error ? err.message : String(err);
  }

  const snapshotUrl = opts.snapshotUrl === undefined ? API.snapshot : opts.snapshotUrl;
  if (snapshotUrl) {
    try {
      const res = await fetchWithTimeout(new URL(snapshotUrl, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').toString(), fetchImpl, API.timeoutMs);
      if (res.ok) {
        const snap = (await res.json()) as SnapshotFile;
        if (snap && snap.contributors && snap.workers) {
          return build(
            snap.contributors,
            snap.workers,
            new Date(snap.capturedAt),
            'snapshot',
            `Live API unavailable (${liveError}). Showing the snapshot bundled with this build.`,
            now(),
          );
        }
      }
    } catch {
      // fall through to the live error
    }
  }
  throw new Error(`Could not load api.imd.fun: ${liveError}`);
}

function build(
  c: ContributorsResponse | ContributorRecord[],
  w: WorkersResponse | WorkerRecord[],
  asOf: Date,
  source: 'live' | 'snapshot',
  warning: string | null,
  now: number,
): DashboardData {
  const contributors = Array.isArray(c) ? c : Array.isArray(c.contributors) ? c.contributors : null;
  const workers = Array.isArray(w) ? w : Array.isArray(w.workers) ? w.workers : null;
  if (!contributors) throw new Error('contributors response has no contributors array');
  if (!workers) throw new Error('workers response has no workers array');
  return {
    rows: joinRows(contributors, workers, now),
    asOf,
    source,
    receipts: !Array.isArray(c) && typeof c.receipts === 'number' ? c.receipts : null,
    tokensPerCompletedJob: !Array.isArray(c) && typeof c.tokensPerCompletedJob === 'number' ? c.tokensPerCompletedJob : null,
    workerCount: workers.length,
    warning,
  };
}

/** Filters ⇄ URL hash query (deep-linkable dashboard state). */
export function filtersToHash(f: DashboardFilters): string {
  const p = new URLSearchParams();
  if (f.query) p.set('q', f.query);
  if (f.onlineOnly) p.set('online', '1');
  if (f.runtime) p.set('runtime', f.runtime);
  if (f.minAccepted > 0) p.set('minAccepted', String(f.minAccepted));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort);
  if (f.dir !== DEFAULT_FILTERS.dir) p.set('dir', f.dir);
  const s = p.toString();
  return s ? `#/?${s}` : '#/';
}

const SORT_KEYS: SortKey[] = [
  'tokenId',
  'wallet',
  'attempts',
  'accepted',
  'rejected',
  'pending',
  'wallClockMs',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'turns',
  'lastHeartbeatAt',
  'daemonVersion',
];

export function filtersFromHash(hash: string): DashboardFilters {
  const idx = hash.indexOf('?');
  const p = new URLSearchParams(idx >= 0 ? hash.slice(idx + 1) : '');
  const sort = p.get('sort') as SortKey | null;
  const dir = p.get('dir');
  const minAccepted = Number(p.get('minAccepted') ?? '0');
  return {
    query: p.get('q') ?? '',
    onlineOnly: p.get('online') === '1',
    runtime: p.get('runtime') ?? '',
    minAccepted: Number.isFinite(minAccepted) && minAccepted > 0 ? Math.floor(minAccepted) : 0,
    sort: sort && SORT_KEYS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_FILTERS.dir,
  };
}
