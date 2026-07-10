/**
 * Offline, network-free sanity check for the Google OAuth config (M73 S2).
 *
 * Run with `npx tsx src/auth/__checks__/verify-auth-config.ts` (or `npm run verify:auth-config`).
 * Only imports `config.ts` and `tokenExchange.ts` — both are pure (no expo/react-native
 * imports) — so this runs under plain Node, no Expo/RN runtime needed.
 *
 * Asserts:
 *  1. The authorization request params (client_id, redirect_uri, scope, PKCE method,
 *     access_type=offline, prompt=consent) are exactly what config.ts declares.
 *  2. exchangeCodeForTokens() POSTs grant_type=authorization_code with client_id +
 *     redirect_uri + code + code_verifier, and no client_secret.
 *  3. refreshAccessToken() POSTs grant_type=refresh_token with client_id + refresh_token,
 *     and no client_secret; falls back to the original refresh_token when Google omits one.
 *  4. Secure-store keys are namespaced under "askewly.auth.*" and distinct from each other.
 */
import {
  AUTH_STORAGE_KEYS,
  AUTH_STORAGE_NAMESPACE,
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_AUTH_EXTRA_PARAMS,
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
} from "../config";
import { exchangeCodeForTokens, refreshAccessToken } from "../tokenExchange";

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok - ${message}`);
  }
}

type FakeCall = { url: string; init: RequestInit };

function fakeFetch(responseBody: Record<string, unknown>) {
  const calls: FakeCall[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

/**
 * Build the same authorization-request params AuthContext.tsx passes to
 * AuthSession.useAuthRequest, so we can assert on them without importing
 * expo-auth-session (which pulls in react-native and can't run under plain Node).
 */
function buildAuthorizationParams() {
  return {
    client_id: GOOGLE_ANDROID_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    code_challenge_method: "S256",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: GOOGLE_AUTH_EXTRA_PARAMS.access_type,
    prompt: GOOGLE_AUTH_EXTRA_PARAMS.prompt,
  };
}

async function main() {
  // 1. Authorization request params.
  const authParams = buildAuthorizationParams();
  assert(
    authParams.client_id === "YOUR_ANDROID_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    "auth request client_id matches the registered Android OAuth client",
  );
  assert(
    authParams.redirect_uri ===
      "com.googleusercontent.apps.YOUR_ANDROID_OAUTH_CLIENT_ID:/oauth2redirect",
    "auth request redirect_uri is the reverse-client-id scheme",
  );
  assert(GOOGLE_AUTHORIZATION_ENDPOINT === "https://accounts.google.com/o/oauth2/v2/auth", "authorization endpoint is Google's");
  assert(authParams.response_type === "code", "auth request uses the authorization-code flow");
  assert(authParams.code_challenge_method === "S256", "auth request declares PKCE S256");
  assert(
    ["tasks", "calendar", "spreadsheets", "drive"].every((scope) =>
      authParams.scope.includes(`https://www.googleapis.com/auth/${scope}`),
    ),
    "auth request scope includes tasks, calendar, spreadsheets, drive",
  );
  assert(authParams.scope.includes("openid") && authParams.scope.includes("email"), "auth request scope includes openid + email");
  assert(authParams.access_type === "offline", "auth request sets access_type=offline (required for a refresh token)");
  assert(authParams.prompt === "consent", "auth request sets prompt=consent (forces refresh token on re-consent)");

  // 2. Authorization-code exchange.
  {
    const { impl, calls } = fakeFetch({ access_token: "fake-access", expires_in: 3600, refresh_token: "fake-refresh" });
    const result = await exchangeCodeForTokens("fake-code", "fake-verifier", impl);
    assert(calls.length === 1, "exchangeCodeForTokens makes exactly one HTTP call");
    const call = calls[0];
    assert(call.url === GOOGLE_TOKEN_ENDPOINT, "exchangeCodeForTokens posts to Google's token endpoint");
    const body = new URLSearchParams(call.init.body as string);
    assert(body.get("grant_type") === "authorization_code", "code exchange sends grant_type=authorization_code");
    assert(body.get("client_id") === GOOGLE_ANDROID_CLIENT_ID, "code exchange sends the Android client_id");
    assert(body.get("redirect_uri") === GOOGLE_REDIRECT_URI, "code exchange sends the same redirect_uri");
    assert(body.get("code") === "fake-code", "code exchange sends the authorization code");
    assert(body.get("code_verifier") === "fake-verifier", "code exchange sends the PKCE code_verifier");
    assert(body.get("client_secret") === null, "code exchange never sends a client_secret (Android client has none)");
    assert(result.accessToken === "fake-access", "code exchange returns the access token");
    assert(result.refreshToken === "fake-refresh", "code exchange returns the refresh token");
    assert(result.expiresAt > Date.now(), "code exchange computes a future expiresAt");
  }

  // 3. Refresh, with a refresh_token in the response.
  {
    const { impl, calls } = fakeFetch({ access_token: "new-access", expires_in: 3600, refresh_token: "rotated-refresh" });
    const result = await refreshAccessToken("old-refresh", impl);
    const body = new URLSearchParams(calls[0].init.body as string);
    assert(body.get("grant_type") === "refresh_token", "refresh sends grant_type=refresh_token");
    assert(body.get("client_id") === GOOGLE_ANDROID_CLIENT_ID, "refresh sends the Android client_id");
    assert(body.get("refresh_token") === "old-refresh", "refresh sends the stored refresh token");
    assert(body.get("client_secret") === null, "refresh never sends a client_secret");
    assert(result.accessToken === "new-access", "refresh returns the new access token");
    assert(result.refreshToken === "rotated-refresh", "refresh keeps a rotated refresh token if Google sends one");
  }

  // 3b. Refresh, with no refresh_token in the response (Google's usual behavior) — must fall back.
  {
    const { impl } = fakeFetch({ access_token: "new-access-2", expires_in: 3600 });
    const result = await refreshAccessToken("old-refresh-2", impl);
    assert(result.refreshToken === "old-refresh-2", "refresh falls back to the original refresh_token when Google omits one");
  }

  // 4. Secure-store key namespacing.
  const keys = Object.values(AUTH_STORAGE_KEYS);
  assert(keys.every((k) => k.startsWith(`${AUTH_STORAGE_NAMESPACE}.`)), "all secure-store keys are namespaced under askewly.auth.");
  assert(new Set(keys).size === keys.length, "secure-store keys are all distinct");

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll auth config checks passed.");
}

main().catch((err) => {
  console.error("verify-auth-config crashed:", err);
  process.exit(1);
});
