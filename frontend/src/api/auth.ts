export type AuthMode = 'login' | 'signup';
export type AppMode = 'order' | 'dapper';
export type DapService = 'UberDap' | 'UberDap Plus' | 'UberDap Deluxe';

export type AuthUser = {
  id: string;
  username: string;
  activeMode: AppMode;
  offeredServices: DapService[];
  hasCompletedOnboarding: boolean;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type OnboardingChoice =
  | { mode: 'order' }
  | { mode: 'dapper'; offeredServices: DapService[] }
  | { skip: true };

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const webSocketApiUrl = apiUrl
  .replace(/^https:/, 'wss:')
  .replace(/^http:/, 'ws:');

export const dapperLocationWebSocketUrl =
  `${webSocketApiUrl}/ws/dapper-location`;

async function requestJson<T>(
  path: string,
  init: RequestInit,
  fallbackError: string,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : fallbackError;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

function authorizedHeaders(token: string, hasBody = false): HeadersInit {
  return hasBody
    ? {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    : {
        Authorization: `Bearer ${token}`,
      };
}

export function authenticate(
  mode: AuthMode,
  username: string,
  password: string,
): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    `/auth/${mode}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
    'Unable to complete your request.',
  );
}

export function fetchCurrentUser(token: string): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>(
    '/auth/me',
    {
      method: 'GET',
      headers: authorizedHeaders(token),
    },
    'Unable to load your account.',
  );
}

export function completeOnboarding(
  token: string,
  choice: OnboardingChoice,
): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>(
    '/auth/onboarding',
    {
      method: 'PATCH',
      headers: authorizedHeaders(token, true),
      body: JSON.stringify(choice),
    },
    'Unable to save your setup choice.',
  );
}

export function updateActiveMode(
  token: string,
  mode: AppMode,
): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>(
    '/auth/mode',
    {
      method: 'PATCH',
      headers: authorizedHeaders(token, true),
      body: JSON.stringify({ mode }),
    },
    'Unable to switch map mode.',
  );
}

export function updateDapperPreferences(
  token: string,
  offeredServices: DapService[],
): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>(
    '/auth/preferences',
    {
      method: 'PATCH',
      headers: authorizedHeaders(token, true),
      body: JSON.stringify({ offeredServices }),
    },
    'Unable to save dapper preferences.',
  );
}

export function deleteAccount(token: string): Promise<void> {
  return requestJson<void>(
    '/auth/account',
    {
      method: 'DELETE',
      headers: authorizedHeaders(token),
    },
    'Unable to delete your account.',
  );
}
