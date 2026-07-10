/**
 * Access-token lifecycle glue: reads/writes secure storage and refreshes via
 * the Google token endpoint when the access token is expired (or about to be).
 */
import { refreshAccessToken, exchangeCodeForTokens } from "./tokenExchange";
import { clearTokens, loadTokens, saveTokens } from "./tokenStore";

/** Refresh this many ms before the token's real expiry to avoid using a token that expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Returns a currently-valid access token, refreshing it first if it's expired
 * (or within the skew window). Returns null if signed out or refresh fails
 * (clearing the stale tokens in that case).
 *
 * `forceRefresh` skips the expiry check and refreshes unconditionally — used
 * by the Google data layer's 401 retry hook (see `google/client.ts`), since a
 * 401 means the token is bad *right now* regardless of what our stored
 * expiry says.
 */
export async function getValidAccessToken(forceRefresh = false): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) {
    return null;
  }
  if (!forceRefresh && Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    await clearTokens();
    return null;
  }
  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    await saveTokens(refreshed);
    return refreshed.accessToken;
  } catch (err) {
    console.warn("[auth] token refresh failed, clearing session", err);
    await clearTokens();
    return null;
  }
}

/** Complete a sign-in by exchanging the authorization code for tokens and persisting them. */
export async function completeSignIn(code: string, codeVerifier: string): Promise<void> {
  const tokens = await exchangeCodeForTokens(code, codeVerifier);
  await saveTokens(tokens);
}

export async function signOut(): Promise<void> {
  await clearTokens();
}
