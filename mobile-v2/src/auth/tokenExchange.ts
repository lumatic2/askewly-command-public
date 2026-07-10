/**
 * Pure Google OAuth token-endpoint calls (authorization_code + PKCE exchange, refresh_token).
 *
 * No expo/react-native imports — only `fetch` (injectable) and `URLSearchParams` — so this
 * module is testable offline from a plain Node script with a fake fetch
 * (see `__checks__/verify-auth-config.ts`).
 *
 * Android OAuth clients have no client secret: neither call sends one.
 */
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_ENDPOINT } from "./config";

export type TokenResult = {
  accessToken: string;
  expiresAt: number; // epoch ms
  refreshToken: string | null;
};

type FetchLike = typeof fetch;

type TokenEndpointResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
};

function toTokenResult(json: TokenEndpointResponse): TokenResult {
  const expiresInSeconds = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    refreshToken: json.refresh_token ?? null,
  };
}

async function postForm(body: URLSearchParams, fetchImpl: FetchLike): Promise<TokenEndpointResponse> {
  const res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token endpoint request failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** Exchange an authorization code (+ PKCE verifier) for an access/refresh token pair. */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: GOOGLE_ANDROID_CLIENT_ID,
    code,
    redirect_uri: GOOGLE_REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  return toTokenResult(await postForm(body, fetchImpl));
}

/** Refresh an access token. Google may omit `refresh_token` on refresh responses — keep the original. */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: GOOGLE_ANDROID_CLIENT_ID,
    refresh_token: refreshToken,
  });
  const result = toTokenResult(await postForm(body, fetchImpl));
  return { ...result, refreshToken: result.refreshToken ?? refreshToken };
}
