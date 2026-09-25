import { formatUnits, parseUnits } from 'viem';

const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** API counters arrive as numbers or decimal strings; normalise to a safe number (or 0). */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function fmtInt(n: number): string {
  return intFmt.format(n);
}

export function fmtCompact(n: number): string {
  return compactFmt.format(n);
}

export function fmtDateTime(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function fmtTime(d: Date): string {
  return timeFmt.format(d);
}

export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.round((t - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return relFmt.format(diffSec, 'second');
  if (abs < 3600) return relFmt.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return relFmt.format(Math.round(diffSec / 3600), 'hour');
  return relFmt.format(Math.round(diffSec / 86400), 'day');
}

/** Milliseconds → "1d 2h 3m" style duration. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Format token minor units with the token's decimals, trimming to a sensible precision. */
export function fmtAmount(value: bigint, decimals: number, maxFraction = 6): string {
  const s = formatUnits(value, decimals);
  const [whole = '0', frac = ''] = s.split('.');
  const wholeFmt = intFmt.format(BigInt(whole));
  const trimmed = frac.slice(0, maxFraction).replace(/0+$/, '');
  return trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt;
}

/** Parse a user amount into minor units; returns null when the input is not a valid positive amount. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null;
  try {
    const v = parseUnits(t, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** Human message for wallet / RPC errors (revert reasons, user rejection). */
export function errorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  const e = err as { code?: number; shortMessage?: string; details?: string; message?: string; cause?: unknown };
  if (e.code === 4001 || /user rejected|user denied/i.test(String(e.shortMessage ?? e.message ?? ''))) {
    return 'Request rejected in the wallet.';
  }
  const parts = [e.shortMessage, e.details].filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (parts.length) return dedupe(parts).join(' ');
  if (typeof e.message === 'string' && e.message) return e.message.split('\n')[0] ?? e.message;
  return String(err);
}

function dedupe(parts: string[]): string[] {
  return parts.filter((p, i) => parts.indexOf(p) === i);
}
