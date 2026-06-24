import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { env } from './env';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'kakao';

export function getRedirectTo() {
  return makeRedirectUri({
    scheme: env.scheme,
    path: env.authRedirectPath
  });
}

function getUrlParams(url: string) {
  const parsed = new URL(url);
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const searchParams = parsed.searchParams;
  const get = (key: string) => hashParams.get(key) || searchParams.get(key);

  return {
    errorCode: get('error_code') || get('error'),
    code: get('code'),
    accessToken: get('access_token'),
    refreshToken: get('refresh_token')
  };
}

export async function createSessionFromUrl(url: string) {
  const params = getUrlParams(url);
  if (params.errorCode) throw new Error(params.errorCode);

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return data.session;
  }

  if (params.accessToken && params.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken
    });
    if (error) throw error;
    return data.session;
  }

  return null;
}

export async function signInWithProvider(provider: OAuthProvider) {
  const redirectTo = getRedirectTo();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: provider === 'google' ? { prompt: 'consent' } : undefined
    }
  });

  if (error) throw error;
  if (!data.url) throw new Error(`No ${provider} OAuth URL returned`);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'success') {
    return createSessionFromUrl(result.url);
  }

  return null;
}
