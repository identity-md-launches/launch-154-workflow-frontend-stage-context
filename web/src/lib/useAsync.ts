import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  updatedAt: number | null;
}

/** Small polling/reload helper for read-only chain and API state. */
export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[], intervalMs = 0): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(fn !== null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!fn) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fn()
      .then((v) => {
        if (cancelled || !alive.current) return;
        setData(v);
        setError(null);
        setUpdatedAt(Date.now());
      })
      .catch((e: unknown) => {
        if (cancelled || !alive.current) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    let timer: ReturnType<typeof setInterval> | null = null;
    if (intervalMs > 0) timer = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, fn === null]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, updatedAt };
}
