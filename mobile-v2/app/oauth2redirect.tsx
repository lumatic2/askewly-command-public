import { Redirect } from "expo-router";

/**
 * Deep-link landing route for the Google OAuth redirect (`askewlycommand://oauth2redirect`).
 *
 * expo-web-browser's `maybeCompleteAuthSession()` (called at AuthContext module scope)
 * intercepts this deep link and closes the in-app browser before this route would ever
 * meaningfully render — this file only exists so expo-router has a matching route and
 * never shows the "Unmatched Route" 404 screen if the redirect is ever handled without
 * the browser session being closed first (e.g. a stale/backgrounded app). It owns no
 * logic of its own: the actual code exchange is done by the `response` effect in
 * `AuthContext.tsx`.
 */
export default function OAuthRedirectScreen() {
  return <Redirect href="/" />;
}
