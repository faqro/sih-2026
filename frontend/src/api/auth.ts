export type AuthMode = 'login' | 'signup';
export type AppMode = 'order' | 'dapper';
export type AuthProvider = 'local' | 'steam' | 'strava' | 'osu';
export type DapService =
  | 'Dap for Poor People'
  | 'Dap (Standard)'
  | 'Dap (Wheelchair-Accessible)'
  | 'Dap & Dash'
  | 'THE GOD DAP'
  | 'Professional Handshake (Black-tie)';

export type AuthUser = {
  id: string;
  username: string;
  name?: string | null;
  authProvider?: AuthProvider;
  steamUsername?: string | null;
  steamAvatar?: string | null;
  stravaUsername?: string | null;
  stravaAvatar?: string | null;
  osuUsername?: string | null;
  osuAvatar?: string | null;
  activeMode: AppMode;
  offeredServices: DapService[];
  crispinessRating?: number | null;
  crispinessRatingCount?: number;
  hasCompletedOnboarding: boolean;
};

export type ProfileUpdatePayload = {
  name?: string | null;
  username?: string;
  currentPassword?: string;
  newPassword?: string;
};

export type DapperRatingItem = {
  id: string;
  requestId: string;
  rating: number;
  comment: string | null;
  service: DapService | null;
  raterName: string;
  ratedAt: string;
};

export type DapperRatingsResponse = {
  averageRating: number | null;
  totalRatings: number;
  breakdown: Record<'1' | '2' | '3' | '4' | '5', number>;
  recentRatings: DapperRatingItem[];
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type SteamSsoStartResponse = {
  authorizeUrl: string;
  state: string;
  pollToken: string;
};

export type SteamSsoStatusResponse =
  | { status: 'pending' }
  | { status: 'completed'; code: string }
  | { status: 'error' | 'expired' | 'cancelled'; message: string };

export type SteamSsoCancelResponse = {
  status: string;
  cancelled: boolean;
};

export type StravaSsoStartResponse = SteamSsoStartResponse;
export type StravaSsoStatusResponse = SteamSsoStatusResponse;
export type StravaSsoCancelResponse = SteamSsoCancelResponse;
export type OsuSsoStartResponse = SteamSsoStartResponse;
export type OsuSsoStatusResponse = SteamSsoStatusResponse;
export type OsuSsoCancelResponse = SteamSsoCancelResponse;

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

export function submitDapRating(
  token: string,
  requestId: string,
  rating: number,
  comment?: string,
): Promise<{ crispinessRating: number; crispinessRatingCount?: number }> {
  const trimmedComment = comment?.trim();
  return requestJson<{ crispinessRating: number; crispinessRatingCount?: number }>(
    `/dap-requests/${encodeURIComponent(requestId)}/rating`,
    {
      method: 'POST',
      headers: authorizedHeaders(token, true),
      body: JSON.stringify(
        trimmedComment ? { rating, comment: trimmedComment } : { rating },
      ),
    },
    'Unable to save the UberDap rating.',
  );
}

export function updateProfile(
  token: string,
  payload: ProfileUpdatePayload,
): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/auth/profile',
    {
      method: 'PATCH',
      headers: authorizedHeaders(token, true),
      body: JSON.stringify(payload),
    },
    'Unable to update profile settings.',
  );
}

export function fetchDapperRatings(
  token: string,
): Promise<DapperRatingsResponse> {
  return requestJson<DapperRatingsResponse>(
    '/auth/ratings',
    {
      method: 'GET',
      headers: authorizedHeaders(token),
    },
    'Unable to load dapper ratings.',
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

export function startSteamSso(
  returnTo?: string,
): Promise<SteamSsoStartResponse> {
  return requestJson<SteamSsoStartResponse>(
    '/auth/steam/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(returnTo ? { returnTo } : {}),
    },
    'Unable to start Steam Sign-In.',
  );
}

export function exchangeSteamSsoCode(code: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/auth/steam/exchange',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    'Unable to complete Steam Sign-In.',
  );
}

export function fetchSteamSsoStatus(
  state: string,
  pollToken: string,
): Promise<SteamSsoStatusResponse> {
  const params = new URLSearchParams({ state, pollToken });
  return requestJson<SteamSsoStatusResponse>(
    `/auth/steam/status?${params.toString()}`,
    {
      method: 'GET',
    },
    'Unable to check Steam Sign-In status.',
  );
}

export function cancelSteamSso(
  state: string,
  pollToken: string,
): Promise<SteamSsoCancelResponse> {
  return requestJson<SteamSsoCancelResponse>(
    '/auth/steam/cancel',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, pollToken }),
    },
    'Unable to cancel Steam Sign-In.',
  );
}

export function startStravaSso(
  returnTo?: string,
): Promise<StravaSsoStartResponse> {
  return requestJson<StravaSsoStartResponse>(
    '/auth/strava/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(returnTo ? { returnTo } : {}),
    },
    'Unable to start Strava Sign-In.',
  );
}

export function exchangeStravaSsoCode(code: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/auth/strava/exchange',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    'Unable to complete Strava Sign-In.',
  );
}

export function fetchStravaSsoStatus(
  state: string,
  pollToken: string,
): Promise<StravaSsoStatusResponse> {
  const params = new URLSearchParams({ state, pollToken });
  return requestJson<StravaSsoStatusResponse>(
    `/auth/strava/status?${params.toString()}`,
    { method: 'GET' },
    'Unable to check Strava Sign-In status.',
  );
}

export function cancelStravaSso(
  state: string,
  pollToken: string,
): Promise<StravaSsoCancelResponse> {
  return requestJson<StravaSsoCancelResponse>(
    '/auth/strava/cancel',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, pollToken }),
    },
    'Unable to cancel Strava Sign-In.',
  );
}

export function startOsuSso(
  returnTo?: string,
): Promise<OsuSsoStartResponse> {
  return requestJson<OsuSsoStartResponse>(
    '/auth/osu/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(returnTo ? { returnTo } : {}),
    },
    'Unable to start osu! Sign-In.',
  );
}

export function exchangeOsuSsoCode(code: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>(
    '/auth/osu/exchange',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    'Unable to complete osu! Sign-In.',
  );
}

export function fetchOsuSsoStatus(
  state: string,
  pollToken: string,
): Promise<OsuSsoStatusResponse> {
  const params = new URLSearchParams({ state, pollToken });
  return requestJson<OsuSsoStatusResponse>(
    `/auth/osu/status?${params.toString()}`,
    { method: 'GET' },
    'Unable to check osu! Sign-In status.',
  );
}

export function cancelOsuSso(
  state: string,
  pollToken: string,
): Promise<OsuSsoCancelResponse> {
  return requestJson<OsuSsoCancelResponse>(
    '/auth/osu/cancel',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, pollToken }),
    },
    'Unable to cancel osu! Sign-In.',
  );
}
