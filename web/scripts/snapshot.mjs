#!/usr/bin/env node
// Captures a trimmed copy of the public dashboard APIs into public/data/snapshot.json.
// The app tries the live APIs first and only shows this file (clearly labelled with its
// capture time) when the live request fails, e.g. because the API sends no CORS headers for
// the hosting origin. Best effort: a failed capture keeps an existing snapshot and never fails
// the build.
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_DIR } from './lib.mjs';

const CONTRIBUTORS = 'https://api.imd.fun/contributors';
const WORKERS = 'https://api.imd.fun/workers';
const target = join(WEB_DIR, 'public', 'data', 'snapshot.json');

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

try {
  const [c, w] = await Promise.all([getJson(CONTRIBUTORS), getJson(WORKERS)]);
  const contributors = (Array.isArray(c) ? c : c.contributors ?? []).map((x) =>
    pick(x, ['deviceKey', 'wallet', 'tokenId', 'attempts', 'accepted', 'rejected', 'pending', 'wallClockMs', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'turns']),
  );
  const workers = (Array.isArray(w) ? w : w.workers ?? []).map((x) => ({
    ...pick(x, ['deviceKey', 'seat', 'daemonVersion', 'lastHeartbeatAt', 'working']),
    runtimes: (x.runtimes ?? []).map((r) => pick(r, ['id', 'version'])),
  }));
  const snapshot = {
    capturedAt: new Date().toISOString(),
    contributors: { ...(Array.isArray(c) ? {} : pick(c, ['receipts', 'tokensPerCompletedJob'])), contributors },
    workers: { count: workers.length, workers },
  };
  mkdirSync(join(WEB_DIR, 'public', 'data'), { recursive: true });
  writeFileSync(target, JSON.stringify(snapshot) + '\n');
  console.log(`snapshot: ${contributors.length} contributors, ${workers.length} workers, ${statSync(target).size} bytes`);
} catch (err) {
  console.warn(`snapshot capture failed (${err instanceof Error ? err.message : err}); ` + (existsSync(target) ? 'keeping the existing snapshot' : 'no snapshot will be bundled'));
}
