/**
 * Google OAuth config for the mobile-v2 native sign-in flow (M73 S2).
 *
 * Pure constants only — no expo/react-native imports — so this module can be
 * required from a plain Node script (see `__checks__/verify-auth-config.ts`)
 * without pulling in native runtime code.
 */

/** Android OAuth client (GCP project auto-stitch-gc5y6t). No client secret — Android clients don't get one. */
export const GOOGLE_ANDROID_CLIENT_ID =
  "YOUR_ANDROID_OAUTH_CLIENT_ID.apps.googleusercontent.com";

/**
 * Reverse-client-id scheme redirect, registered as an Android intent filter via app.json
 * `scheme`. This is Google's standard automatic redirect for Android OAuth clients.
 *
 * Empirically verified live (2026-07-10): requesting `askewlycommand://oauth2redirect`
 * as the redirect_uri is REJECTED by Google with "Error 400: invalid_request — Access
 * blocked: Authorization Error / doesn't comply with Google's OAuth 2.0 policy". Only
 * the reverse-client-id scheme is accepted for this Android client. Do not change this
 * without re-verifying live against accounts.google.com.
 */
export const GOOGLE_REDIRECT_URI =
  "com.googleusercontent.apps.YOUR_ANDROID_OAUTH_CLIENT_ID:/oauth2redirect";

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_DISCOVERY = {
  authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
  tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
  revocationEndpoint: GOOGLE_REVOCATION_ENDPOINT,
} as const;

/** Scopes for Tasks/Calendar/Sheets/Drive data access + basic identity. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
] as const;

/** Extra authorization params required to get a refresh token back from Google on first consent. */
export const GOOGLE_AUTH_EXTRA_PARAMS = {
  access_type: "offline",
  prompt: "consent",
} as const;

export const AUTH_STORAGE_NAMESPACE = "askewly.auth";

/** expo-secure-store keys, namespaced so they don't collide with other stored values. */
export const AUTH_STORAGE_KEYS = {
  accessToken: `${AUTH_STORAGE_NAMESPACE}.accessToken`,
  expiresAt: `${AUTH_STORAGE_NAMESPACE}.expiresAt`,
  refreshToken: `${AUTH_STORAGE_NAMESPACE}.refreshToken`,
} as const;
