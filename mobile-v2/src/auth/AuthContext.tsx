import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_AUTH_EXTRA_PARAMS,
  GOOGLE_DISCOVERY,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
} from "./config";
import { completeSignIn, getValidAccessToken, signOut as clearSignedInSession } from "./googleAuth";

// Required once at module scope so the browser-based auth session can close
// itself and hand control back to the app after the redirect fires.
WebBrowser.maybeCompleteAuthSession();

type AuthStatus = "loading" | "signedOut" | "signedIn";

type AuthContextValue = {
  status: AuthStatus;
  isRequestReady: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_ANDROID_CLIENT_ID,
      redirectUri: GOOGLE_REDIRECT_URI,
      scopes: [...GOOGLE_SCOPES],
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
      extraParams: { ...GOOGLE_AUTH_EXTRA_PARAMS },
    },
    GOOGLE_DISCOVERY,
  );

  // Restore an existing session on mount (getValidAccessToken refreshes if needed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getValidAccessToken();
      if (!cancelled) {
        setStatus(token ? "signedIn" : "signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Complete the flow once the auth session redirects back with a code.
  useEffect(() => {
    if (response?.type !== "success") {
      return;
    }
    const code = response.params?.code;
    const codeVerifier = request?.codeVerifier;
    if (!code || !codeVerifier) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await completeSignIn(code, codeVerifier);
        if (!cancelled) {
          setStatus("signedIn");
        }
      } catch (err) {
        console.warn("[auth] sign-in token exchange failed", err);
        if (!cancelled) {
          setStatus("signedOut");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [response, request?.codeVerifier]);

  const signIn = useCallback(async () => {
    await promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    await clearSignedInSession();
    setStatus("signedOut");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, isRequestReady: !!request, signIn, signOut }),
    [status, request, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
