import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  type JsonWebKeyInput,
  type KeyObject,
} from 'node:crypto';
import jwt, { type Algorithm } from 'jsonwebtoken';

const DEFAULT_ISSUER = 'https://oauth.chess.com';
const DEFAULT_DISCOVERY_URL =
  'https://oauth.chess.com/.well-known/openid-configuration';
const DEFAULT_AUTHORIZE_URL = 'https://oauth.chess.com/authorize';
const DEFAULT_TOKEN_URL = 'https://oauth.chess.com/token';
const DEFAULT_USERINFO_URL = 'https://oauth.chess.com/userinfo';
const DEFAULT_JWKS_URL = 'https://oauth.chess.com/.well-known/jwks.json';
const FALLBACK_JWKS_URL = 'https://oauth.chess.com/certs';
const DEFAULT_SCOPES = 'openid profile';
const DEFAULT_USER_AGENT = 'UberDaps/1.0 (https://uberdaps.app)';

const SESSION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFRESH_INTERVAL_MS = 10 * 1000;

const ALLOWED_ID_TOKEN_ALGORITHMS: readonly Algorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
];

export class ChessOAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChessOAuthConfigError';
  }
}

export class ChessOAuthFlowError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ChessOAuthFlowError';
    this.status = status;
  }
}

type OAuthEndpoints = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
  hasExplicitJwksUri: boolean;
};

type JwkEntry = JsonWebKeyInput['key'] & {
  kid?: string;
  use?: string;
  alg?: string;
  kty?: string;
};

type OAuthSession = {
  state: string;
  pollToken: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  returnTo: string | null;
  createdAt: number;
  status: 'pending' | 'completed' | 'error' | 'cancelled';
  inFlight: boolean;
  exchangeCode?: string;
  errorMessage?: string;
};

export type ChessUserProfile = {
  chessId: string;
  chessUsername: string;
  chessAvatar: string | null;
};

export type ChessExchangePayload<TUser> = {
  token: string;
  user: TUser;
  createdAt: number;
};

const oauthSessions = new Map<string, OAuthSession>();
const exchangeCodes = new Map<string, ChessExchangePayload<unknown>>();

let cachedDiscovery: {
  endpoints: Omit<OAuthEndpoints, 'hasExplicitJwksUri'> & {
    discoveredJwksUri: string | null;
  };
  fetchedAt: number;
} | null = null;

let cachedJwks: {
  jwksUri: string;
  keys: JwkEntry[];
  fetchedAt: number;
} | null = null;

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateRandomToken(byteLength = 32): string {
  return toBase64Url(randomBytes(byteLength));
}

function createPkceChallenge(verifier: string): string {
  return toBase64Url(createHash('sha256').update(verifier).digest());
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

  for (const [state, session] of oauthSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      oauthSessions.delete(state);
    }
  }

  for (const [code, payload] of exchangeCodes) {
    if (now - payload.createdAt > EXCHANGE_CODE_TTL_MS) {
      exchangeCodes.delete(code);
    }
  }
}

function getClientId(): string {
  const clientId = process.env.CHESS_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new ChessOAuthConfigError(
      'Chess.com SSO is not configured on the backend. Set CHESS_OAUTH_CLIENT_ID in backend/.env.',
    );
  }
  return clientId;
}

function getClientSecret(): string | undefined {
  const secret = process.env.CHESS_OAUTH_CLIENT_SECRET?.trim();
  return secret || undefined;
}

function getScopes(): string {
  return process.env.CHESS_OAUTH_SCOPES?.trim() || DEFAULT_SCOPES;
}

function getUserAgent(): string {
  return process.env.CHESS_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

export async function resolveChessOAuthEndpoints(): Promise<OAuthEndpoints> {
  const explicitIssuer = process.env.CHESS_OAUTH_ISSUER?.trim();
  const explicitAuthorize = process.env.CHESS_OAUTH_AUTHORIZE_URL?.trim();
  const explicitToken = process.env.CHESS_OAUTH_TOKEN_URL?.trim();
  const explicitUserinfo = process.env.CHESS_OAUTH_USERINFO_URL?.trim();
  const explicitJwks = process.env.CHESS_OAUTH_JWKS_URL?.trim();

  if (
    explicitIssuer &&
    explicitAuthorize &&
    explicitToken &&
    explicitUserinfo &&
    explicitJwks
  ) {
    return {
      issuer: explicitIssuer,
      authorizationEndpoint: explicitAuthorize,
      tokenEndpoint: explicitToken,
      userinfoEndpoint: explicitUserinfo,
      jwksUri: explicitJwks,
      hasExplicitJwksUri: true,
    };
  }

  if (
    cachedDiscovery &&
    Date.now() - cachedDiscovery.fetchedAt < DISCOVERY_CACHE_TTL_MS
  ) {
    return {
      issuer: explicitIssuer || cachedDiscovery.endpoints.issuer,
      authorizationEndpoint:
        explicitAuthorize || cachedDiscovery.endpoints.authorizationEndpoint,
      tokenEndpoint: explicitToken || cachedDiscovery.endpoints.tokenEndpoint,
      userinfoEndpoint:
        explicitUserinfo || cachedDiscovery.endpoints.userinfoEndpoint,
      jwksUri:
        explicitJwks ||
        cachedDiscovery.endpoints.discoveredJwksUri ||
        DEFAULT_JWKS_URL,
      hasExplicitJwksUri: Boolean(
        explicitJwks || cachedDiscovery.endpoints.discoveredJwksUri,
      ),
    };
  }

  const discoveryUrl =
    process.env.CHESS_OAUTH_DISCOVERY_URL?.trim() || DEFAULT_DISCOVERY_URL;

  try {
    const response = await fetch(discoveryUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': getUserAgent(),
      },
      signal: AbortSignal.timeout(4000),
    });

    if (response.ok) {
      const doc = (await response.json()) as Record<string, unknown>;
      const discoveredJwksUri =
        typeof doc.jwks_uri === 'string' && doc.jwks_uri.trim().length > 0
          ? doc.jwks_uri.trim()
          : null;
      const discovered = {
        issuer:
          typeof doc.issuer === 'string' && doc.issuer.trim().length > 0
            ? doc.issuer.trim()
            : DEFAULT_ISSUER,
        authorizationEndpoint:
          typeof doc.authorization_endpoint === 'string'
            ? doc.authorization_endpoint
            : DEFAULT_AUTHORIZE_URL,
        tokenEndpoint:
          typeof doc.token_endpoint === 'string'
            ? doc.token_endpoint
            : DEFAULT_TOKEN_URL,
        userinfoEndpoint:
          typeof doc.userinfo_endpoint === 'string'
            ? doc.userinfo_endpoint
            : DEFAULT_USERINFO_URL,
        jwksUri: discoveredJwksUri || DEFAULT_JWKS_URL,
        discoveredJwksUri,
      };

      cachedDiscovery = { endpoints: discovered, fetchedAt: Date.now() };

      return {
        issuer: explicitIssuer || discovered.issuer,
        authorizationEndpoint:
          explicitAuthorize || discovered.authorizationEndpoint,
        tokenEndpoint: explicitToken || discovered.tokenEndpoint,
        userinfoEndpoint: explicitUserinfo || discovered.userinfoEndpoint,
        jwksUri: explicitJwks || discovered.discoveredJwksUri || DEFAULT_JWKS_URL,
        hasExplicitJwksUri: Boolean(explicitJwks || discovered.discoveredJwksUri),
      };
    }
  } catch {
    // Fall back to standard Chess.com OAuth2 endpoints if discovery is unreachable.
  }

  return {
    issuer: explicitIssuer || DEFAULT_ISSUER,
    authorizationEndpoint: explicitAuthorize || DEFAULT_AUTHORIZE_URL,
    tokenEndpoint: explicitToken || DEFAULT_TOKEN_URL,
    userinfoEndpoint: explicitUserinfo || DEFAULT_USERINFO_URL,
    jwksUri: explicitJwks || DEFAULT_JWKS_URL,
    hasExplicitJwksUri: Boolean(explicitJwks),
  };
}

export async function createChessAuthorizationSession(options: {
  redirectUri: string;
  returnTo: string | null;
}): Promise<{ authorizeUrl: string; state: string; pollToken: string }> {
  cleanupExpiredEntries();

  const clientId = getClientId();
  const endpoints = await resolveChessOAuthEndpoints();
  const state = generateRandomToken(24);
  const pollToken = generateRandomToken(24);
  const codeVerifier = generateRandomToken(32);
  const codeChallenge = createPkceChallenge(codeVerifier);
  const nonce = generateRandomToken(16);

  oauthSessions.set(state, {
    state,
    pollToken,
    codeVerifier,
    nonce,
    redirectUri: options.redirectUri,
    returnTo: options.returnTo,
    createdAt: Date.now(),
    status: 'pending',
    inFlight: false,
  });

  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', getScopes());
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { authorizeUrl: url.toString(), state, pollToken };
}

export function getChessOAuthSession(state: string): OAuthSession | null {
  cleanupExpiredEntries();
  return oauthSessions.get(state) ?? null;
}

export function getChessOAuthSessionForPoll(
  state: string,
  pollToken: string,
):
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; session: OAuthSession } {
  cleanupExpiredEntries();
  const session = oauthSessions.get(state);
  if (!session) {
    return { kind: 'expired' };
  }

  if (!constantTimeTokenMatch(session.pollToken, pollToken)) {
    return { kind: 'unauthorized' };
  }

  return { kind: 'ok', session };
}

export function cancelChessOAuthSession(
  state: string,
  pollToken: string,
):
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'ok'; cancelled: boolean; status: OAuthSession['status'] } {
  cleanupExpiredEntries();
  const session = oauthSessions.get(state);
  if (!session) {
    return { kind: 'expired' };
  }

  if (!constantTimeTokenMatch(session.pollToken, pollToken)) {
    return { kind: 'unauthorized' };
  }

  if (session.status === 'pending') {
    session.status = 'cancelled';
    session.errorMessage = 'Chess.com sign-in was cancelled.';
    return { kind: 'ok', cancelled: true, status: session.status };
  }

  return {
    kind: 'ok',
    cancelled: session.status === 'cancelled',
    status: session.status,
  };
}

export function markChessSessionError(
  state: string,
  errorMessage: string,
): OAuthSession | null {
  const session = oauthSessions.get(state);
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

export function completeChessSessionWithCode(
  state: string,
  exchangeCode: string,
): boolean {
  const session = oauthSessions.get(state);
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

async function fetchJwksKeysFromUrl(jwksUri: string): Promise<JwkEntry[] | null> {
  try {
    const response = await fetch(jwksUri, {
      headers: {
        Accept: 'application/json',
        'User-Agent': getUserAgent(),
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json().catch(() => null)) as {
      keys?: unknown;
    } | null;

    if (!body || !Array.isArray(body.keys)) {
      return null;
    }

    return body.keys.filter(
      (entry): entry is JwkEntry =>
        typeof entry === 'object' && entry !== null && 'kty' in entry,
    );
  } catch {
    return null;
  }
}

async function resolveChessJwksKeys(
  endpoints: OAuthEndpoints,
  forceRefresh = false,
): Promise<JwkEntry[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedJwks &&
    cachedJwks.jwksUri === endpoints.jwksUri &&
    now - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS
  ) {
    return cachedJwks.keys;
  }

  if (
    forceRefresh &&
    cachedJwks &&
    cachedJwks.jwksUri === endpoints.jwksUri &&
    now - cachedJwks.fetchedAt < JWKS_MIN_REFRESH_INTERVAL_MS
  ) {
    return cachedJwks.keys;
  }

  let keys = await fetchJwksKeysFromUrl(endpoints.jwksUri);
  let resolvedUri = endpoints.jwksUri;

  if ((!keys || keys.length === 0) && !endpoints.hasExplicitJwksUri) {
    const fallbackKeys = await fetchJwksKeysFromUrl(FALLBACK_JWKS_URL);
    if (fallbackKeys && fallbackKeys.length > 0) {
      keys = fallbackKeys;
      resolvedUri = FALLBACK_JWKS_URL;
    }
  }

  if (!keys || keys.length === 0) {
    throw new ChessOAuthFlowError(
      'Unable to fetch Chess.com JWKS signing keys to verify identity token.',
      502,
    );
  }

  cachedJwks = {
    jwksUri: resolvedUri,
    keys,
    fetchedAt: now,
  };

  return keys;
}

function isMatchingJwkForAlgorithm(jwk: JwkEntry, alg: Algorithm): boolean {
  if (jwk.use && jwk.use !== 'sig') {
    return false;
  }
  if (jwk.alg && jwk.alg !== alg) {
    return false;
  }
  if (alg.startsWith('RS') || alg.startsWith('PS')) {
    return jwk.kty === 'RSA';
  }
  if (alg.startsWith('ES')) {
    return jwk.kty === 'EC';
  }
  return true;
}

function buildPublicKeyFromJwk(jwk: JwkEntry): KeyObject {
  return createPublicKey({
    key: jwk,
    format: 'jwk',
  });
}

function buildAllowedIssuers(issuer: string): string | [string, ...string[]] {
  const trimmed = issuer.trim();
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  const withTrailingSlash = `${withoutTrailingSlash}/`;
  const candidates = Array.from(
    new Set([trimmed, withoutTrailingSlash, withTrailingSlash]),
  ).filter((value) => value.length > 0);

  if (candidates.length === 1) {
    return candidates[0];
  }

  return [candidates[0], ...candidates.slice(1)];
}

async function verifyChessIdToken(options: {
  idToken: string;
  clientId: string;
  expectedNonce: string;
  endpoints: OAuthEndpoints;
}): Promise<Record<string, unknown>> {
  const decoded = jwt.decode(options.idToken, { complete: true });

  if (
    !decoded ||
    typeof decoded === 'string' ||
    typeof decoded.header?.alg !== 'string'
  ) {
    throw new ChessOAuthFlowError(
      'Chess.com returned a malformed identity token.',
      401,
    );
  }

  const alg = decoded.header.alg as Algorithm;
  if (!ALLOWED_ID_TOKEN_ALGORITHMS.includes(alg)) {
    throw new ChessOAuthFlowError(
      'Chess.com identity token uses an unsupported signature algorithm.',
      401,
    );
  }

  const kid =
    typeof decoded.header.kid === 'string' && decoded.header.kid.trim()
      ? decoded.header.kid.trim()
      : null;

  let keys = await resolveChessJwksKeys(options.endpoints, false);
  let candidateKeys = kid
    ? keys.filter((key) => key.kid === kid && isMatchingJwkForAlgorithm(key, alg))
    : keys.filter((key) => isMatchingJwkForAlgorithm(key, alg));

  if (candidateKeys.length === 0) {
    keys = await resolveChessJwksKeys(options.endpoints, true);
    candidateKeys = kid
      ? keys.filter(
          (key) => key.kid === kid && isMatchingJwkForAlgorithm(key, alg),
        )
      : keys.filter((key) => isMatchingJwkForAlgorithm(key, alg));
  }

  if (candidateKeys.length === 0) {
    throw new ChessOAuthFlowError(
      'Unable to find matching Chess.com signing key for identity token.',
      401,
    );
  }

  const allowedIssuers = buildAllowedIssuers(options.endpoints.issuer);
  let verifiedPayload: string | jwt.JwtPayload | null = null;
  let lastError: unknown = null;

  for (const jwk of candidateKeys) {
    try {
      const publicKey = buildPublicKeyFromJwk(jwk);
      verifiedPayload = jwt.verify(options.idToken, publicKey, {
        algorithms: [alg],
        audience: options.clientId,
        issuer: allowedIssuers,
        clockTolerance: 30,
      });
      break;
    } catch (error) {
      if (!(lastError instanceof jwt.TokenExpiredError)) {
        lastError = error;
      }
    }
  }

  if (
    !verifiedPayload ||
    typeof verifiedPayload === 'string' ||
    typeof verifiedPayload !== 'object'
  ) {
    if (lastError instanceof jwt.TokenExpiredError) {
      throw new ChessOAuthFlowError(
        'Chess.com identity token has expired.',
        401,
      );
    }
    throw new ChessOAuthFlowError(
      'Invalid Chess.com identity token signature or claims.',
      401,
    );
  }

  const claims = verifiedPayload as Record<string, unknown>;
  if (claims.nonce !== undefined) {
    const claimNonce = readStringClaim(claims, ['nonce']);
    if (!claimNonce || claimNonce !== options.expectedNonce) {
      throw new ChessOAuthFlowError(
        'Invalid Chess.com authentication nonce.',
        401,
      );
    }
  }

  return claims;
}

function readStringClaim(
  source: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function readIdentifierClaim(
  source: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

async function fetchPublicChessAvatar(
  username: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': getUserAgent(),
        },
        signal: AbortSignal.timeout(2500),
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    return typeof data.avatar === 'string' && data.avatar.trim().length > 0
      ? data.avatar.trim()
      : null;
  } catch {
    return null;
  }
}

function isSessionPending(session: OAuthSession): boolean {
  return session.status === 'pending';
}

export async function exchangeChessAuthorizationCode(options: {
  state: string;
  code: string;
}): Promise<{ profile: ChessUserProfile; session: OAuthSession }> {
  cleanupExpiredEntries();

  const session = oauthSessions.get(options.state);
  if (!session || session.status !== 'pending') {
    throw new ChessOAuthFlowError(
      session?.status === 'cancelled'
        ? 'Chess.com sign-in was cancelled.'
        : 'Chess.com sign-in session expired or is invalid. Please try again.',
      400,
    );
  }

  if (session.inFlight) {
    throw new ChessOAuthFlowError(
      'Chess.com sign-in is already being processed.',
      409,
    );
  }

  session.inFlight = true;
  try {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const endpoints = await resolveChessOAuthEndpoints();

    if (!isSessionPending(session)) {
      throw new ChessOAuthFlowError('Chess.com sign-in was cancelled.', 400);
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: session.redirectUri,
      client_id: clientId,
      code_verifier: session.codeVerifier,
    });

    if (clientSecret) {
      tokenParams.set('client_secret', clientSecret);
    }

    const tokenResponse = await fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': getUserAgent(),
      },
      body: tokenParams.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const tokenBody = (await tokenResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!tokenResponse.ok || !tokenBody) {
      const remoteError = readStringClaim(tokenBody, [
        'error_description',
        'error',
        'message',
      ]);
      throw new ChessOAuthFlowError(
        remoteError || 'Unable to verify Chess.com authorization code.',
        502,
      );
    }

    const accessToken = readStringClaim(tokenBody, ['access_token']);
    const idToken = readStringClaim(tokenBody, ['id_token']);

    if (!accessToken && !idToken) {
      throw new ChessOAuthFlowError(
        'Chess.com did not return an access token or identity token.',
        502,
      );
    }

    const idClaims = idToken
      ? await verifyChessIdToken({
          idToken,
          clientId,
          expectedNonce: session.nonce,
          endpoints,
        })
      : null;

    let userInfo: Record<string, unknown> | null = null;
    if (accessToken) {
      try {
        const userInfoResponse = await fetch(endpoints.userinfoEndpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'User-Agent': getUserAgent(),
          },
          signal: AbortSignal.timeout(8000),
        });

        if (userInfoResponse.ok) {
          userInfo = (await userInfoResponse.json()) as Record<string, unknown>;
        }
      } catch {
        // Fall back to verified ID token claims if userinfo fails while ID token is present.
      }
    }

    if (!idClaims && !userInfo) {
      throw new ChessOAuthFlowError(
        'Unable to retrieve Chess.com user profile claims.',
        502,
      );
    }

    const userInfoSub = readIdentifierClaim(userInfo, [
      'sub',
      'user_id',
      'player_id',
      'id',
    ]);
    const idTokenSub = readIdentifierClaim(idClaims, [
      'sub',
      'user_id',
      'player_id',
      'id',
    ]);

    if (userInfoSub && idTokenSub && userInfoSub !== idTokenSub) {
      throw new ChessOAuthFlowError(
        'Chess.com userinfo subject does not match identity token.',
        401,
      );
    }

    const rawUsername =
      readStringClaim(userInfo, [
        'preferred_username',
        'username',
        'nickname',
        'name',
      ]) ||
      readStringClaim(idClaims, [
        'preferred_username',
        'username',
        'nickname',
        'name',
      ]);

    const rawSub = idTokenSub || userInfoSub;

    const chessUsername = rawUsername
      ? rawUsername.toLowerCase()
      : rawSub
        ? `chess_${rawSub.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`
        : null;

    const chessId =
      rawSub || (chessUsername ? `username:${chessUsername}` : null);

    if (!chessId || !chessUsername) {
      throw new ChessOAuthFlowError(
        'Chess.com did not return a user identifier.',
        502,
      );
    }

    let chessAvatar =
      readStringClaim(userInfo, ['picture', 'avatar', 'avatar_url']) ||
      readStringClaim(idClaims, ['picture', 'avatar', 'avatar_url']);

    if (!chessAvatar && rawUsername) {
      chessAvatar = await fetchPublicChessAvatar(rawUsername);
    }

    if (!isSessionPending(session)) {
      throw new ChessOAuthFlowError('Chess.com sign-in was cancelled.', 400);
    }

    return {
      profile: {
        chessId,
        chessUsername,
        chessAvatar,
      },
      session,
    };
  } finally {
    session.inFlight = false;
  }
}
