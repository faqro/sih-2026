import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuthSession } from './models/OAuthStore.js';

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const SESSION_TTL_MS = 10 * 60 * 1000;

export class StravaAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StravaAuthConfigError';
  }
}

export class StravaAuthFlowError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StravaAuthFlowError';
    this.status = status;
  }
}

type StravaSession = {
  state: string;
  pollToken: string;
  redirectUri: string;
  returnTo: string | null;
  status: 'pending' | 'completed' | 'error' | 'cancelled';
  inFlight: boolean;
  exchangeCode?: string | null;
  errorMessage?: string | null;
};

export type StravaUserProfile = {
  stravaId: string;
  stravaUsername: string;
  stravaAvatar: string | null;
  name: string | null;
};

function generateToken(byteLength = 24): string {
  return randomBytes(byteLength).toString('base64url');
}

function constantTimeTokenMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function createStravaAuthorizationSession(options: {
  redirectUri: string;
  returnTo: string | null;
}): Promise<{ authorizeUrl: string; state: string; pollToken: string }> {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  if (!clientId) {
    throw new StravaAuthConfigError('STRAVA_CLIENT_ID is not configured.');
  }

  const state = generateToken();
  const pollToken = generateToken();
  await OAuthSession.create({
    state,
    provider: 'strava',
    pollToken,
    redirectUri: options.redirectUri,
    returnTo: options.returnTo,
    status: 'pending',
    inFlight: false,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  const authorizeUrl = new URL(STRAVA_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', options.redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('approval_prompt', 'auto');
  authorizeUrl.searchParams.set('scope', 'read');
  authorizeUrl.searchParams.set('state', state);

  return { authorizeUrl: authorizeUrl.toString(), state, pollToken };
}

export async function getStravaAuthSession(
  state: string,
): Promise<StravaSession | null> {
  return OAuthSession.findOne({
    state,
    provider: 'strava',
    expiresAt: { $gt: new Date() },
  }).lean();
}

export async function getStravaAuthSessionForPoll(
  state: string,
  pollToken: string,
): Promise<
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; session: StravaSession }
> {
  const session = await getStravaAuthSession(state);
  if (!session) {
    return { kind: 'expired' };
  }
  if (!constantTimeTokenMatch(session.pollToken, pollToken)) {
    return { kind: 'unauthorized' };
  }
  return { kind: 'ok', session };
}

export async function cancelStravaAuthSession(
  state: string,
  pollToken: string,
): Promise<
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; cancelled: boolean; status: StravaSession['status'] }
> {
  const lookup = await getStravaAuthSessionForPoll(state, pollToken);
  if (lookup.kind !== 'ok') {
    return lookup;
  }
  const { session } = lookup;
  if (session.status === 'pending') {
    const updated = await OAuthSession.findOneAndUpdate(
      { state, provider: 'strava', status: 'pending' },
      { $set: { status: 'cancelled', errorMessage: 'Strava sign-in was cancelled.' } },
      { new: true },
    ).lean();
    if (updated) {
      return { kind: 'ok', cancelled: true, status: updated.status };
    }
  }
  return {
    kind: 'ok',
    cancelled: session.status === 'cancelled',
    status: session.status,
  };
}

export async function markStravaSessionError(
  state: string,
  errorMessage: string,
): Promise<StravaSession | null> {
  if (!state) {
    return null;
  }
  return OAuthSession.findOneAndUpdate(
    { state, provider: 'strava', status: 'pending' },
    { $set: { status: 'error', errorMessage } },
    { new: true },
  ).lean();
}

export async function completeStravaSessionWithCode(
  state: string,
  exchangeCode: string,
): Promise<boolean> {
  const updated = await OAuthSession.findOneAndUpdate(
    { state, provider: 'strava', status: 'pending' },
    { $set: { status: 'completed', exchangeCode } },
    { new: true },
  ).lean();
  return updated !== null;
}

export async function verifyStravaOAuthCallback(options: {
  state: string;
  code: string;
  scope: string;
}): Promise<{ profile: StravaUserProfile; session: StravaSession }> {
  const claimed = await OAuthSession.findOneAndUpdate(
    {
      state: options.state,
      provider: 'strava',
      status: 'pending',
      inFlight: false,
      expiresAt: { $gt: new Date() },
    },
    { $set: { inFlight: true } },
    { new: true },
  ).lean();

  if (!claimed) {
    const existing = await getStravaAuthSession(options.state);
    if (existing?.inFlight) {
      throw new StravaAuthFlowError(
        'Strava sign-in is already being processed.',
        409,
      );
    }
    throw new StravaAuthFlowError(
      existing?.status === 'cancelled'
        ? 'Strava sign-in was cancelled.'
        : 'Strava sign-in session expired or is invalid. Please try again.',
      400,
    );
  }

  try {
    if (!options.scope.split(',').map((scope) => scope.trim()).includes('read')) {
      throw new StravaAuthFlowError(
        'Strava did not grant the required read permission.',
        403,
      );
    }

    const clientId = process.env.STRAVA_CLIENT_ID?.trim();
    const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new StravaAuthConfigError(
        'STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be configured.',
      );
    }

    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: options.code,
      grant_type: 'authorization_code',
    });
    const tokenResponse = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) {
      throw new StravaAuthFlowError(
        'Strava rejected the authorization code.',
        401,
      );
    }

    const tokenPayload: unknown = await tokenResponse.json();
    if (!isRecord(tokenPayload) || !isRecord(tokenPayload.athlete)) {
      throw new StravaAuthFlowError(
        'Strava returned an invalid athlete profile.',
        502,
      );
    }

    const athlete = tokenPayload.athlete;
    const stravaId =
      typeof athlete.id === 'number' || typeof athlete.id === 'string'
        ? String(athlete.id)
        : '';
    if (!/^\d+$/.test(stravaId)) {
      throw new StravaAuthFlowError(
        'Strava returned an invalid athlete ID.',
        502,
      );
    }

    const stravaUsername =
      readString(athlete.username) ||
      [readString(athlete.firstname), readString(athlete.lastname)]
        .filter(Boolean)
        .join(' ') ||
      `strava_${stravaId}`;
    const name =
      [readString(athlete.firstname), readString(athlete.lastname)]
        .filter(Boolean)
        .join(' ') || null;
    const stravaAvatar =
      readString(athlete.profile) || readString(athlete.profile_medium) || null;

    const latest = await getStravaAuthSession(options.state);
    if (!latest || latest.status !== 'pending') {
      throw new StravaAuthFlowError('Strava sign-in was cancelled.', 400);
    }

    return {
      profile: { stravaId, stravaUsername, stravaAvatar, name },
      session: latest,
    };
  } finally {
    await OAuthSession.updateOne(
      { state: options.state, provider: 'strava' },
      { $set: { inFlight: false } },
    ).catch(() => {});
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
