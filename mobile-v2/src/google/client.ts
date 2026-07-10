/**
 * Authenticated fetch wrapper for Google REST APIs (Tasks/Calendar/Sheets/Drive).
 *
 * Framework-free: `fetchFn` and `getToken` are injected, so this module (and
 * everything built on it) is testable under plain Node with a fake fetch —
 * see `__checks__/verify-google-client.ts`. No expo/react-native imports.
 */

export type FetchLike = typeof fetch;

/**
 * Returns a currently-valid access token, or null if signed out.
 * `forceRefresh` is passed `true` exactly once, on a 401 retry, so a real
 * implementation can force a token refresh instead of trusting its own
 * expiry bookkeeping (which may be wrong, e.g. after a revoke).
 */
export type TokenGetter = (forceRefresh?: boolean) => Promise<string | null>;

export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export type GoogleClientOptions = {
  getToken: TokenGetter;
  fetchFn?: FetchLike;
};

/**
 * Fetches `url`, attaching `Authorization: Bearer <token>`. On a 401, calls
 * `getToken(true)` once to force a refresh and retries exactly once more.
 * Throws `GoogleApiError` for any other non-OK response, or if no token is
 * available at all (signed out).
 */
export async function googleFetchJson<T = unknown>(
  url: string,
  init: RequestInit,
  { getToken, fetchFn = fetch }: GoogleClientOptions,
): Promise<T> {
  const attempt = async (forceRefresh: boolean): Promise<Response> => {
    const token = await getToken(forceRefresh);
    if (!token) {
      throw new GoogleApiError("No Google access token available (signed out)", 0);
    }
    return fetchFn(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
  };

  let res = await attempt(false);
  if (res.status === 401) {
    res = await attempt(true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GoogleApiError(
      `Google API request failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function googleGet<T = unknown>(url: string, opts: GoogleClientOptions): Promise<T> {
  return googleFetchJson<T>(url, { method: "GET" }, opts);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function googlePost<T = unknown>(url: string, body: unknown, opts: GoogleClientOptions): Promise<T> {
  return googleFetchJson<T>(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }, opts);
}

export function googlePatch<T = unknown>(url: string, body: unknown, opts: GoogleClientOptions): Promise<T> {
  return googleFetchJson<T>(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) }, opts);
}

export function googleDelete(url: string, opts: GoogleClientOptions): Promise<void> {
  return googleFetchJson<void>(url, { method: "DELETE" }, opts);
}
