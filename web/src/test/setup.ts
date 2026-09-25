import '@testing-library/jest-dom/vitest';

// jsdom supplies its own AbortController/AbortSignal while fetch/Request come from Node (undici).
// viem builds `new Request(url, { signal })` before calling fetch, and undici rejects a foreign
// AbortSignal. Strip the signal for the Request constructor in tests only; the mocked fetch
// still receives the original init (including the signal).
const NativeRequest = globalThis.Request;
class TolerantRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const rest = init ? { ...init } : undefined;
    if (rest) delete (rest as { signal?: unknown }).signal;
    super(input, rest);
  }
}
globalThis.Request = TolerantRequest as unknown as typeof Request;
