import { useCallback, useEffect, useState } from "react";
import type { Fetched } from "../google";

type State<T> = {
  data: T | null;
  stale: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

/**
 * Wraps one of the `google/index.ts` fetchers (`getTodaySnapshot`, `getBacklog`, ...)
 * with loading/refreshing/error/stale state for a tab screen. `refresh()` is meant
 * for pull-to-refresh (keeps showing the old data while refetching); the initial
 * load uses `loading` instead so the screen can show a spinner/blank state.
 */
export function useFetched<T>(fetcher: () => Promise<Fetched<T>>, deps: unknown[]): State<T> & { refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await fetcher();
        setData(result.data);
        setStale(result.stale);
        setError(null);
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return { data, stale, loading, refreshing, error, refresh: () => load(true) };
}
