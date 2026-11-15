import { randomBytes, timingSafeEqual } from 'node:crypto';

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_OPENID_NS = 'http://specs.openid.net/auth/2.0';
const STEAM_IDENTIFIER_SELECT =
  'http://specs.openid.net/auth/2.0/identifier_select';
const STEAM_PLAYER_SUMMARIES_URL =
  'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/';
const DEFAULT_USER_AGENT = 'UberDaps/1.0 (https://uberdaps.app)';

const SESSION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
const NONCE_TTL_MS = 15 * 60 * 1000;

const REQUIRED_SIGNED_FIELDS = [
  'op_endpoint',
  'claimed_id',
  'identity',
  'return_to',
  'response_nonce',
  'assoc_handle',
] as const;

export class SteamAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SteamAuthConfigError';
  }
}

export class SteamAuthFlowError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SteamAuthFlowError';
    this.status = status;
  }
}

type SteamSession = {
  state: string;
  pollToken: string;
  callbackUrl: string;
  realm: string;
  returnTo: string | null;
  createdAt: number;
  status: 'pending' | 'completed' | 'error' | 'cancelled';
  inFlight: boolean;
  exchangeCode?: string;
  errorMessage?: string;
};

export type SteamUserProfile = {
  steamId: string;
  steamUsername: string;
  steamAvatar: string | null;
};

export type SteamExchangePayload<TUser> = {
  token: string;
  user: TUser;
  createdAt: number;
};

const steamSessions = new Map<string, SteamSession>();
const exchangeCodes = new Map<string, SteamExchangePayload<unknown>>();
const usedNonces = new Map<string, number>();

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateRandomToken(byteLength = 24): string {
  return toBase64Url(randomBytes(byteLength));
}

function constantTimeTokenMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

function cleanupExpiredEntries(): void {
  const now = Date.now();

  for (const [state, session] of steamSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      steamSessions.delete(state);
    }
  }

  for (const [code, payload] of exchangeCodes) {
    if (now - payload.createdAt > EXCHANGE_CODE_TTL_MS) {
      exchangeCodes.delete(code);
    }
  }

  for (const [nonce, recordedAt] of usedNonces) {
    if (now - recordedAt > NONCE_TTL_MS) {
      usedNonces.delete(nonce);
    }
  }
}

function getSteamApiKey(): string | undefined {
  const apiKey = process.env.STEAM_API_KEY?.trim();
  return apiKey || undefined;
}

function getUserAgent(): string {
  return process.env.STEAM_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

export function createSteamAuthorizationSession(options: {
  callbackBaseUrl: string;
  returnTo: string | null;
}): { authorizeUrl: string; state: string; pollToken: string } {
  cleanupExpiredEntries();

  const state = generateRandomToken(24);
  const pollToken = generateRandomToken(24);

  const callbackParsed = new URL(options.callbackBaseUrl);
  callbackParsed.searchParams.set('state', state);
  const callbackUrl = callbackParsed.toString();
  const realm = callbackParsed.origin;

  steamSessions.set(state, {
    state,
    pollToken,
    callbackUrl,
    realm,
    returnTo: options.returnTo,
    createdAt: Date.now(),
    status: 'pending',
    inFlight: false,
  });

  const authorizeUrl = new URL(STEAM_OPENID_ENDPOINT);
  authorizeUrl.searchParams.set('openid.ns', STEAM_OPENID_NS);
  authorizeUrl.searchParams.set('openid.mode', 'checkid_setup');
  authorizeUrl.searchParams.set('openid.return_to', callbackUrl);
  authorizeUrl.searchParams.set('openid.realm', realm);
  authorizeUrl.searchParams.set('openid.identity', STEAM_IDENTIFIER_SELECT);
  authorizeUrl.searchParams.set('openid.claimed_id', STEAM_IDENTIFIER_SELECT);

  return {
    authorizeUrl: authorizeUrl.toString(),
    state,
    pollToken,
  };
}

export function getSteamAuthSession(state: string): SteamSession | null {
  cleanupExpiredEntries();
  return steamSessions.get(state) ?? null;
}

export function getSteamAuthSessionForPoll(
  state: string,
  pollToken: string,
):
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; session: SteamSession } {
  cleanupExpiredEntries();
  const session = steamSessions.get(state);
  if (!session) {
    return { kind: 'expired' };
  }

  if (!constantTimeTokenMatch(session.pollToken, pollToken)) {
    return { kind: 'unauthorized' };
  }

  return { kind: 'ok', session };
}

export function cancelSteamAuthSession(
  state: string,
  pollToken: string,
):
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; cancelled: boolean; status: SteamSession['status'] } {
  cleanupExpiredEntries();
  const session = steamSessions.get(state);
  if (!session) {
    return { kind: 'expired' };
  }

  if (!constantTimeTokenMatch(session.pollToken, pollToken)) {
    return { kind: 'unauthorized' };
  }

  if (session.status === 'pending') {
    session.status = 'cancelled';
    session.errorMessage = 'Steam sign-in was cancelled.';
    return { kind: 'ok', cancelled: true, status: session.status };
  }

  return {
    kind: 'ok',
    cancelled: session.status === 'cancelled',
    status: session.status,
  };
}

export function markSteamSessionError(
  state: string,
  errorMessage: string,
): SteamSession | null {
  const session = steamSessions.get(state);
  if (
    !session ||
    session.status === 'cancelled' ||
    session.status === 'completed'
  ) {
    return session ?? null;
  }

  session.status = 'error';
  session.errorMessage = errorMessage;
  return session;
}

export function completeSteamSessionWithCode(
  state: string,
  exchangeCode: string,
): boolean {
  const session = steamSessions.get(state);
  if (!session || session.status !== 'pending') {
    return false;
  }

  session.status = 'completed';
  session.exchangeCode = exchangeCode;
  return true;
}

export function createExchangeCode<TUser>(
  token: string,
  user: TUser,
): string {
  cleanupExpiredEntries();
  const code = generateRandomToken(24);
  exchangeCodes.set(code, {
    token,
    user,
    createdAt: Date.now(),
  });
  return code;
}

export function consumeExchangeCode<TUser>(
  code: string,
): { token: string; user: TUser } | null {
  cleanupExpiredEntries();
  const payload = exchangeCodes.get(code);
  if (!payload) {
    return null;
  }

  exchangeCodes.delete(code);
  return {
    token: payload.token,
    user: payload.user as TUser,
  };
}

function readOpenIdParams(
  query: Record<string, unknown>,
): Record<string, string> {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('openid.') && typeof value === 'string') {
      params[key] = value;
    }
  }

  const nested = query.openid;
  if (typeof nested === 'object' && nested !== null) {
    for (const [subKey, value] of Object.entries(
      nested as Record<string, unknown>,
    )) {
      const fullKey = `openid.${subKey}`;
      if (!(fullKey in params) && typeof value === 'string') {
        params[fullKey] = value;
      }
    }
  }

  return params;
}

function extractSteamId(claimedId: string): string | null {
  const match =
    /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{15,25})\/?$/.exec(
      claimedId.trim(),
    );
  return match ? match[1] : null;
}

function parseOpenIdKeyValueResponse(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchSteamProfileFromWebApi(
  steamId: string,
  apiKey: string,
): Promise<{ steamUsername: string | null; steamAvatar: string | null } | null> {
  try {
    const url = new URL(STEAM_PLAYER_SUMMARIES_URL);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId);

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': getUserAgent(),
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      response?: { players?: Array<Record<string, unknown>> };
    };
    const player = data?.response?.players?.[0];
    if (!player) {
      return null;
    }

    const steamUsername =
      typeof player.personaname === 'string' &&
      player.personaname.trim().length > 0
        ? player.personaname.trim()
        : null;
    const steamAvatar =
      (typeof player.avatarfull === 'string' && player.avatarfull.trim()) ||
      (typeof player.avatarmedium === 'string' && player.avatarmedium.trim()) ||
      (typeof player.avatar === 'string' && player.avatar.trim()) ||
      null;

    return { steamUsername, steamAvatar };
  } catch {
    return null;
  }
}

async function fetchSteamProfileFromPublicXml(
  steamId: string,
): Promise<{ steamUsername: string | null; steamAvatar: string | null } | null> {
  try {
    const response = await fetch(
      `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}/?xml=1`,
      {
        headers: {
          Accept: 'application/xml, text/xml',
          'User-Agent': getUserAgent(),
        },
        signal: AbortSignal.timeout(4000),
      },
    );

    if (!response.ok) {
      return null;
    }

    const xml = await response.text();
    const nameMatch = /<steamID>([\s\S]*?)<\/steamID>/i.exec(xml);
    const avatarMatch = /<avatarFull>([\s\S]*?)<\/avatarFull>/i.exec(xml);

    const steamUsername = nameMatch ? decodeXmlEntities(nameMatch[1]) : null;
    const steamAvatar = avatarMatch ? decodeXmlEntities(avatarMatch[1]) : null;

    return {
      steamUsername: steamUsername && steamUsername.length > 0 ? steamUsername : null,
      steamAvatar: steamAvatar && steamAvatar.length > 0 ? steamAvatar : null,
    };
  } catch {
    return null;
  }
}

async function fetchSteamPlayerProfile(
  steamId: string,
): Promise<SteamUserProfile> {
  const apiKey = getSteamApiKey();
  const apiProfile = apiKey
    ? await fetchSteamProfileFromWebApi(steamId, apiKey)
    : null;

  const fallbackProfile =
    apiProfile && apiProfile.steamUsername
      ? apiProfile
      : await fetchSteamProfileFromPublicXml(steamId);

  const steamUsername =
    apiProfile?.steamUsername ||
    fallbackProfile?.steamUsername ||
    `steam_${steamId.slice(-8)}`;
  const steamAvatar =
    apiProfile?.steamAvatar || fallbackProfile?.steamAvatar || null;

  return {
    steamId,
    steamUsername,
    steamAvatar,
  };
}

function isSameCallbackUrl(expected: string, actual: string): boolean {
  try {
    const expectedUrl = new URL(expected);
    const actualUrl = new URL(actual);
    return (
      expectedUrl.origin === actualUrl.origin &&
      expectedUrl.pathname === actualUrl.pathname &&
      expectedUrl.searchParams.get('state') ===
        actualUrl.searchParams.get('state')
    );
  } catch {
    return false;
  }
}

export async function verifySteamOpenIdCallback(options: {
  state: string;
  query: Record<string, unknown>;
}): Promise<{ profile: SteamUserProfile; session: SteamSession }> {
  cleanupExpiredEntries();

  const session = steamSessions.get(options.state);
  if (!session || session.status !== 'pending') {
    throw new SteamAuthFlowError(
      session?.status === 'cancelled'
        ? 'Steam sign-in was cancelled.'
        : 'Steam sign-in session expired or is invalid. Please try again.',
      400,
    );
  }

  if (session.inFlight) {
    throw new SteamAuthFlowError(
      'Steam sign-in is already being processed.',
      409,
    );
  }

  session.inFlight = true;
  try {
    const openIdParams = readOpenIdParams(options.query);
    const mode = openIdParams['openid.mode'];

    if (mode === 'cancel') {
      throw new SteamAuthFlowError('Steam sign-in was cancelled.', 400);
    }

    if (mode !== 'id_res') {
      throw new SteamAuthFlowError(
        'Steam returned an unexpected OpenID response mode.',
        400,
      );
    }

    if (openIdParams['openid.ns'] !== STEAM_OPENID_NS) {
      throw new SteamAuthFlowError(
        'Steam returned an unsupported OpenID namespace.',
        401,
      );
    }

    if (openIdParams['openid.op_endpoint'] !== STEAM_OPENID_ENDPOINT) {
      throw new SteamAuthFlowError(
        'Steam OpenID endpoint mismatch.',
        401,
      );
    }

    const returnedTo = openIdParams['openid.return_to'] || '';
    if (!isSameCallbackUrl(session.callbackUrl, returnedTo)) {
      throw new SteamAuthFlowError(
        'Steam OpenID return_to URL did not match this sign-in session.',
        401,
      );
    }

    const claimedId = openIdParams['openid.claimed_id'] || '';
    const identity = openIdParams['openid.identity'] || '';
    if (!claimedId || claimedId !== identity) {
      throw new SteamAuthFlowError(
        'Steam OpenID identity mismatch.',
        401,
      );
    }

    const steamId = extractSteamId(claimedId);
    if (!steamId) {
      throw new SteamAuthFlowError(
        'Unable to extract Steam ID from OpenID response.',
        401,
      );
    }

    const signedList = (openIdParams['openid.signed'] || '')
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field.length > 0);
    for (const requiredField of REQUIRED_SIGNED_FIELDS) {
      if (!signedList.includes(requiredField)) {
        throw new SteamAuthFlowError(
          'Steam OpenID response is missing required signed fields.',
          401,
        );
      }
    }

    const responseNonce = openIdParams['openid.response_nonce'] || '';
    if (!responseNonce || usedNonces.has(responseNonce)) {
      throw new SteamAuthFlowError(
        'Invalid or replayed Steam OpenID nonce.',
        401,
      );
    }

    const verificationBody = new URLSearchParams();
    for (const [key, value] of Object.entries(openIdParams)) {
      verificationBody.set(
        key,
        key === 'openid.mode' ? 'check_authentication' : value,
      );
    }

    const verifyResponse = await fetch(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/plain',
        'User-Agent': getUserAgent(),
      },
      body: verificationBody.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!verifyResponse.ok) {
      throw new SteamAuthFlowError(
        'Unable to verify Steam OpenID assertion with Steam.',
        502,
      );
    }

    const responseText = await verifyResponse.text();
    const parsedResponse = parseOpenIdKeyValueResponse(responseText);
    if (parsedResponse.is_valid !== 'true') {
      throw new SteamAuthFlowError(
        'Steam rejected the OpenID authentication assertion.',
        401,
      );
    }

    usedNonces.set(responseNonce, Date.now());

    const profile = await fetchSteamPlayerProfile(steamId);

    if (session.status !== 'pending') {
      throw new SteamAuthFlowError('Steam sign-in was cancelled.', 400);
    }

    return { profile, session };
  } finally {
    session.inFlight = false;
  }
}
