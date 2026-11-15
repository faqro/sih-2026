import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuthSession } from './models/OAuthStore.js';

const OSU_AUTHORIZE_URL = 'https://osu.ppy.sh/oauth/authorize';
const OSU_TOKEN_URL = 'https://osu.ppy.sh/oauth/token';
const OSU_ME_URL = 'https://osu.ppy.sh/api/v2/me';
const SESSION_TTL_MS = 10 * 60 * 1000;

export class OsuAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsuAuthConfigError';
  }
}

export class OsuAuthFlowError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'OsuAuthFlowError';
    this.status = status;
  }
}

type OsuSession = {
  state: string;
  pollToken: string;
  redirectUri: string;
  returnTo: string | null;
  status: 'pending' | 'completed' | 'error' | 'cancelled';
  inFlight: boolean;
  exchangeCode?: string | null;
  errorMessage?: string | null;
};

export type OsuUserProfile = {
  osuId: string;
  osuUsername: string;
  osuAvatar: string | null;
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

export async function createOsuAuthorizationSession(options: {
  redirectUri: string;
  returnTo: string | null;
}): Promise<{ authorizeUrl: string; state: string; pollToken: string }> {
  const clientId = process.env.OSU_CLIENT_ID?.trim();
  if (!clientId) {
    throw new OsuAuthConfigError('OSU_CLIENT_ID is not configured.');
  }

  const state = generateToken();
  const pollToken = generateToken();
  await OAuthSession.create({
    state,
    provider: 'osu',
    pollToken,
    redirectUri: options.redirectUri,
    returnTo: options.returnTo,
    status: 'pending',
    inFlight: false,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  const authorizeUrl = new URL(OSU_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', options.redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify');
  authorizeUrl.searchParams.set('state', state);

  return { authorizeUrl: authorizeUrl.toString(), state, pollToken };
}

export async function getOsuAuthSession(
  state: string,
): Promise<OsuSession | null> {
  return OAuthSession.findOne({
    state,
    provider: 'osu',
    expiresAt: { $gt: new Date() },
  }).lean();
}

export async function getOsuAuthSessionForPoll(
  state: string,
  pollToken: string,
): Promise<
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; session: OsuSession }
> {
  const session = await getOsuAuthSession(state);
  if (!session) {
    return { kind: 'expired' };
  }
  if (!constantTimeTokenMatch(session.pollToken, pollToken)) {
    return { kind: 'unauthorized' };
  }
  return { kind: 'ok', session };
}

export async function cancelOsuAuthSession(
  state: string,
  pollToken: string,
): Promise<
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; cancelled: boolean; status: OsuSession['status'] }
> {
  const lookup = await getOsuAuthSessionForPoll(state, pollToken);
  if (lookup.kind !== 'ok') {
    return lookup;
  }
  const { session } = lookup;
  if (session.status === 'pending') {
    const updated = await OAuthSession.findOneAndUpdate(
      { state, provider: 'osu', status: 'pending' },
      { $set: { status: 'cancelled', errorMessage: 'osu! sign-in was cancelled.' } },
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

export async function markOsuSessionError(
  state: string,
  errorMessage: string,
): Promise<OsuSession | null> {
  if (!state) {
    return null;
  }
  return OAuthSession.findOneAndUpdate(
    { state, provider: 'osu', status: 'pending' },
    { $set: { status: 'error', errorMessage } },
    { new: true },
  ).lean();
}

export async function completeOsuSessionWithCode(
  state: string,
  exchangeCode: string,
): Promise<boolean> {
  const updated = await OAuthSession.findOneAndUpdate(
    { state, provider: 'osu', status: 'pending' },
    { $set: { status: 'completed', exchangeCode } },
    { new: true },
  ).lean();
  return updated !== null;
}

export async function verifyOsuOAuthCallback(options: {
  state: string;
  code: string;
}): Promise<{ profile: OsuUserProfile; session: OsuSession }> {
  const claimed = await OAuthSession.findOneAndUpdate(
    {
      state: options.state,
      provider: 'osu',
      status: 'pending',
      inFlight: false,
      expiresAt: { $gt: new Date() },
    },
    { $set: { inFlight: true } },
    { new: true },
  ).lean();

  if (!claimed) {
    const existing = await getOsuAuthSession(options.state);
    if (existing?.inFlight) {
      throw new OsuAuthFlowError(
        'osu! sign-in is already being processed.',
        409,
      );
    }
    throw new OsuAuthFlowError(
      existing?.status === 'cancelled'
        ? 'osu! sign-in was cancelled.'
        : 'osu! sign-in session expired or is invalid. Please try again.',
      400,
    );
  }

  try {
    const clientId = process.env.OSU_CLIENT_ID?.trim();
    const clientSecret = process.env.OSU_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new OsuAuthConfigError(
        'OSU_CLIENT_ID and OSU_CLIENT_SECRET must be configured.',
      );
    }

    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: options.code,
      grant_type: 'authorization_code',
      redirect_uri: claimed.redirectUri,
    });

    const tokenResponse = await fetch(OSU_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenResponse.ok) {
      throw new OsuAuthFlowError(
        'osu! rejected the authorization code.',
        401,
      );
    }

    const tokenPayload: unknown = await tokenResponse.json();
    if (
      !isRecord(tokenPayload) ||
      typeof tokenPayload.access_token !== 'string' ||
      tokenPayload.access_token.trim().length === 0
    ) {
      throw new OsuAuthFlowError(
        'osu! returned an invalid token response.',
        502,
      );
    }

    const meResponse = await fetch(OSU_ME_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!meResponse.ok) {
      throw new OsuAuthFlowError(
        'Unable to load osu! user profile.',
        502,
      );
    }

    const mePayload: unknown = await meResponse.json();
    if (!isRecord(mePayload)) {
      throw new OsuAuthFlowError(
        'osu! returned an invalid user profile.',
        502,
      );
    }

    const osuId =
      typeof mePayload.id === 'number' || typeof mePayload.id === 'string'
        ? String(mePayload.id)
        : '';
    if (!/^\d+$/.test(osuId)) {
      throw new OsuAuthFlowError('osu! returned an invalid user ID.', 502);
    }

    const osuUsername =
      readString(mePayload.username) || `osu_${osuId}`;
    const osuAvatar = readString(mePayload.avatar_url);

    const latest = await getOsuAuthSession(options.state);
    if (!latest || latest.status !== 'pending') {
      throw new OsuAuthFlowError('osu! sign-in was cancelled.', 400);
    }

    return {
      profile: { osuId, osuUsername, osuAvatar },
      session: latest,
    };
  } finally {
    await OAuthSession.updateOne(
      { state: options.state, provider: 'osu' },
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
