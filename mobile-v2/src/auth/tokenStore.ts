/**
 * Secure on-device token storage (expo-secure-store). Keys are namespaced via
 * `config.ts#AUTH_STORAGE_KEYS` so they can't collide with other stored values.
 */
import * as SecureStore from "expo-secure-store";
import { AUTH_STORAGE_KEYS } from "./config";

export type StoredTokens = {
  accessToken: string;
  expiresAt: number; // epoch ms
  refreshToken: string | null;
};

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.accessToken, tokens.accessToken);
  await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.expiresAt, String(tokens.expiresAt));
  if (tokens.refreshToken) {
    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.refreshToken, tokens.refreshToken);
  }
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const [accessToken, expiresAtRaw, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(AUTH_STORAGE_KEYS.accessToken),
    SecureStore.getItemAsync(AUTH_STORAGE_KEYS.expiresAt),
    SecureStore.getItemAsync(AUTH_STORAGE_KEYS.refreshToken),
  ]);
  if (!accessToken || !expiresAtRaw) {
    return null;
  }
  return { accessToken, expiresAt: Number(expiresAtRaw), refreshToken };
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.accessToken),
    SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.expiresAt),
    SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.refreshToken),
  ]);
}
