const AUTH_TOKEN_STORAGE_KEY = 'uberdaps.authToken';

function getWebStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }

  return null;
}

export function loadAuthToken(): string | null {
  try {
    return getWebStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveAuthToken(token: string): void {
  try {
    getWebStorage()?.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures in restricted or non-web environments.
  }
}

export function clearAuthToken(): void {
  try {
    getWebStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures in restricted or non-web environments.
  }
}
