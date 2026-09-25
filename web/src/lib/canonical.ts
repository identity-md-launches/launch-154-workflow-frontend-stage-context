import { keccak256, stringToBytes } from 'viem';

/** Deterministic JSON encoding: keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Keccak-256 of the canonical JSON, 64 lowercase hex characters without 0x. */
export function canonicalKeccak(value: unknown): string {
  return keccak256(stringToBytes(canonicalJson(value))).slice(2);
}
