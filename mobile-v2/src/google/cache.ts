/**
 * Tiny in-memory TTL cache with stale-fallback-on-error, extracted as its own
 * pure module (no expo/react-native imports) so it's testable under plain
 * Node — see `__checks__/verify-google-client.ts`. Used by `index.ts` to
 * cache each of the 4 tabs' Google data for 5 minutes, and to serve the last
 * good value (marked `stale: true`) if a refetch fails instead of throwing.
 */

export type Fetched<T> = { data: T; stale: boolean };

export class TtlCache {
  private store = new Map<string, { data: unknown; fetchedAt: number }>();

  constructor(private ttlMs: number) {}

  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    now: () => number = Date.now,
  ): Promise<Fetched<T>> {
    const cached = this.store.get(key) as { data: T; fetchedAt: number } | undefined;
    if (cached && now() - cached.fetchedAt < this.ttlMs) {
      return { data: cached.data, stale: false };
    }
    try {
      const data = await fetcher();
      this.store.set(key, { data, fetchedAt: now() });
      return { data, stale: false };
    } catch (err) {
      if (cached) {
        return { data: cached.data, stale: true };
      }
      throw err;
    }
  }

  clear(): void {
    this.store.clear();
  }
}
