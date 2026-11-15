import 'dotenv/config';

import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';

import {
  ChessOAuthConfigError,
  ChessOAuthFlowError,
  cancelChessOAuthSession,
  completeChessSessionWithCode,
  consumeExchangeCode,
  createChessAuthorizationSession,
  createExchangeCode,
  exchangeChessAuthorizationCode,
  getChessOAuthSession,
  getChessOAuthSessionForPoll,
  markChessSessionError,
  type ChessUserProfile,
} from './chessOAuth.js';
import { User, type AppMode, type AuthProvider } from './models/User.js';

const app = express();
const server = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });
const port = Number(process.env.PORT ?? 3000);
const mongoUri = requireEnvironmentVariable('MONGODB_URI');
const jwtSecret = requireEnvironmentVariable('JWT_SECRET');
const activeDappers = new Map<
  string,
  {
    socket: WebSocket;
    location: { latitude: number; longitude: number; updatedAt: number } | null;
  }
>();

server.on('upgrade', (request, socket, head) => {
  let pathname: string;

  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== '/ws/dapper-location') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit('connection', webSocket, request);
  });
});

webSocketServer.on('connection', (socket) => {
  let userId: string | null = null;
  let isAuthenticating = false;

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      socket.close(1003, 'Text messages are required.');
      return;
    }

    let message: unknown;

    try {
      message = JSON.parse(data.toString());
    } catch {
      socket.close(1007, 'Invalid JSON message.');
      return;
    }

    if (!isRecord(message)) {
      socket.close(1008, 'Invalid message.');
      return;
    }

    void handleDapperSocketMessage(socket, message, {
      getUserId: () => userId,
      setUserId: (nextUserId) => {
        userId = nextUserId;
      },
      isAuthenticating: () => isAuthenticating,
      setAuthenticating: (value) => {
        isAuthenticating = value;
      },
    }).catch((error: unknown) => {
      console.error('Unable to process dapper location message:', error);
      socket.close(1011, 'Unable to process message.');
    });
  });

  socket.on('close', () => {
    if (userId) {
      removeActiveDapper(userId, socket);
    }
  });

  socket.on('error', (error) => {
    console.error('Dapper location WebSocket error:', error);
  });
});

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? true }));
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/auth/signup', async (request, response) => {
  const credentials = readCredentials(request, response);

  if (!credentials) {
    return;
  }

  try {
    const user = await User.create({
      username: credentials.username,
      password: credentials.password,
      activeMode: 'order',
      hasCompletedOnboarding: false,
    });

    sendAuthResponse(response, serializeUser(user));
  } catch (error) {
    if (isDuplicateUsernameError(error)) {
      response.status(409).json({ message: 'This username is already taken.' });
      return;
    }

    console.error('Unable to create user:', error);
    response.status(500).json({ message: 'Unable to create account.' });
  }
});

app.post('/auth/login', async (request, response) => {
  const credentials = readCredentials(request, response);

  if (!credentials) {
    return;
  }

  try {
    const user = await User.findOne({ username: credentials.username }).select(
      '+password',
    );

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    if (user.authProvider === 'chess' || !user.password) {
      response.status(400).json({
        message:
          'This account uses Chess.com Sign-In. Please tap "Continue with Chess.com".',
      });
      return;
    }

    if (credentials.password !== user.password) {
      response.status(401).json({
        message: `Wrong password. Did you mean to write '${user.password}'?`,
      });
      return;
    }

    sendAuthResponse(response, serializeUser(user));
  } catch (error) {
    console.error('Unable to sign in:', error);
    response.status(500).json({ message: 'Unable to sign in.' });
  }
});

app.post('/auth/chess/start', async (request, response) => {
  const body: unknown = request.body;
  const rawReturnTo =
    isRecord(body) && typeof body.returnTo === 'string' ? body.returnTo : null;
  const requestedRedirectUri =
    isRecord(body) && 'redirectUri' in body ? body.redirectUri : undefined;
  const returnTo = resolveSafeReturnTo(rawReturnTo);

  try {
    const redirectUri = resolveChessRedirectUri(request, requestedRedirectUri);
    const session = await createChessAuthorizationSession({
      redirectUri,
      returnTo,
    });
    response.status(200).json(session);
  } catch (error) {
    if (error instanceof ChessOAuthConfigError) {
      response.status(503).json({ message: error.message });
      return;
    }

    if (error instanceof ChessOAuthFlowError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    console.error('Unable to start Chess.com SSO:', error);
    response.status(500).json({ message: 'Unable to start Chess.com Sign-In.' });
  }
});

app.get('/auth/chess/callback', async (request, response) => {
  const state =
    typeof request.query.state === 'string' ? request.query.state : '';
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  const oauthError =
    typeof request.query.error === 'string' ? request.query.error : '';
  const oauthErrorDescription =
    typeof request.query.error_description === 'string'
      ? request.query.error_description
      : '';

  const existingSession = state ? getChessOAuthSession(state) : null;
  const fallbackReturnTo = resolveSafeReturnTo(existingSession?.returnTo ?? null);

  if (oauthError) {
    const message =
      oauthError === 'access_denied'
        ? 'Chess.com sign-in was cancelled.'
        : oauthErrorDescription || `Chess.com sign-in failed (${oauthError}).`;

    if (state) {
      markChessSessionError(state, message);
    }

    sendChessCallbackError(response, fallbackReturnTo, message);
    return;
  }

  if (!state || !code) {
    const message = 'Missing authorization code or state from Chess.com.';
    if (state) {
      markChessSessionError(state, message);
    }
    sendChessCallbackError(response, fallbackReturnTo, message);
    return;
  }

  try {
    const { profile, session } = await exchangeChessAuthorizationCode({
      state,
      code,
    });
    if (session.status !== 'pending') {
      throw new ChessOAuthFlowError('Chess.com sign-in was cancelled.', 400);
    }

    const user = await findOrCreateChessUser(profile);
    const serialized = serializeUser(user);
    const token = signUserToken(serialized);
    const exchangeCode = createExchangeCode(token, serialized);

    if (!completeChessSessionWithCode(state, exchangeCode)) {
      consumeExchangeCode(exchangeCode);
      throw new ChessOAuthFlowError('Chess.com sign-in was cancelled.', 400);
    }

    const targetReturnTo = resolveSafeReturnTo(session.returnTo);
    if (targetReturnTo && isHttpUrl(targetReturnTo)) {
      const redirectTarget = new URL(targetReturnTo);
      redirectTarget.searchParams.set('chess_code', exchangeCode);
      response.redirect(302, redirectTarget.toString());
      return;
    }

    const deepLinkTarget = buildNativeChessDeepLink(targetReturnTo, {
      chess_code: exchangeCode,
    });

    response
      .status(200)
      .type('html')
      .send(
        renderChessCallbackHtml(
          'Signed in with Chess.com',
          'Returning you to UberDaps. Tap the button below if the app does not open automatically.',
          deepLinkTarget,
        ),
      );
  } catch (error) {
    const message =
      error instanceof ChessOAuthConfigError ||
      error instanceof ChessOAuthFlowError
        ? error.message
        : 'Unable to complete Chess.com Sign-In.';

    console.error('Chess.com SSO callback error:', error);
    markChessSessionError(state, message);
    sendChessCallbackError(response, fallbackReturnTo, message);
  }
});

app.post('/auth/chess/exchange', (request, response) => {
  const body: unknown = request.body;

  if (
    !isRecord(body) ||
    typeof body.code !== 'string' ||
    body.code.trim().length === 0
  ) {
    response.status(400).json({ message: 'Chess.com exchange code is required.' });
    return;
  }

  const payload = consumeExchangeCode<SerializedUser>(body.code.trim());

  if (!payload) {
    response.status(401).json({
      message: 'Chess.com sign-in session expired. Please try again.',
    });
    return;
  }

  response.status(200).json(payload);
});

app.get('/auth/chess/status', (request, response) => {
  const state =
    typeof request.query.state === 'string' ? request.query.state.trim() : '';
  const queryPollToken =
    typeof request.query.pollToken === 'string'
      ? request.query.pollToken.trim()
      : '';
  const headerPollToken =
    request.get('x-chess-poll-token')?.trim() || '';
  const pollToken = queryPollToken || headerPollToken;

  if (!state || !pollToken) {
    response.status(400).json({ message: 'Missing OAuth state or pollToken.' });
    return;
  }

  const lookup = getChessOAuthSessionForPoll(state, pollToken);

  if (lookup.kind === 'expired') {
    response.status(200).json({
      status: 'expired',
      message: 'Chess.com sign-in session expired. Please try again.',
    });
    return;
  }

  if (lookup.kind === 'unauthorized') {
    response.status(403).json({
      message: 'Invalid Chess.com sign-in poll token.',
    });
    return;
  }

  const { session } = lookup;

  if (session.status === 'completed' && session.exchangeCode) {
    response.status(200).json({
      status: 'completed',
      code: session.exchangeCode,
    });
    return;
  }

  if (session.status === 'cancelled') {
    response.status(200).json({
      status: 'cancelled',
      message: session.errorMessage || 'Chess.com sign-in was cancelled.',
    });
    return;
  }

  if (session.status === 'error') {
    response.status(200).json({
      status: 'error',
      message: session.errorMessage || 'Chess.com sign-in failed.',
    });
    return;
  }

  response.status(200).json({ status: 'pending' });
});

app.post('/auth/chess/cancel', (request, response) => {
  const body: unknown = request.body;

  if (
    !isRecord(body) ||
    typeof body.state !== 'string' ||
    body.state.trim().length === 0 ||
    typeof body.pollToken !== 'string' ||
    body.pollToken.trim().length === 0
  ) {
    response.status(400).json({
      message: 'Chess.com OAuth state and pollToken are required.',
    });
    return;
  }

  const result = cancelChessOAuthSession(
    body.state.trim(),
    body.pollToken.trim(),
  );

  if (result.kind === 'expired') {
    response.status(200).json({ status: 'expired', cancelled: false });
    return;
  }

  if (result.kind === 'unauthorized') {
    response.status(403).json({
      message: 'Invalid Chess.com sign-in poll token.',
    });
    return;
  }

  response.status(200).json({
    status: result.status,
    cancelled: result.cancelled,
  });
});

app.get('/auth/me', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    response.status(200).json({ user: serializeUser(user) });
  } catch (error) {
    console.error('Unable to load user profile:', error);
    response.status(500).json({ message: 'Unable to load account.' });
  }
});

app.patch('/auth/onboarding', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  const body: unknown = request.body;

  if (typeof body !== 'object' || body === null) {
    response.status(400).json({ message: 'Invalid onboarding payload.' });
    return;
  }

  const modeInput = 'mode' in body ? body.mode : undefined;
  const hasMode = modeInput !== undefined;
  const hasSkip = 'skip' in body && body.skip === true;

  if (hasMode && !isAppMode(modeInput)) {
    response.status(400).json({
      message: "Mode must be 'order' or 'dapper'.",
    });
    return;
  }

  if (!hasMode && !hasSkip) {
    response.status(400).json({
      message: 'Provide a mode or set skip to true.',
    });
    return;
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    if (isAppMode(modeInput)) {
      user.activeMode = modeInput;
    } else if (!user.hasCompletedOnboarding) {
      // Preserve an existing mode if onboarding was already finished earlier.
      user.activeMode = 'order';
    }

    user.hasCompletedOnboarding = true;
    user.onboardingCompletedAt ??= new Date();

    await user.save();
    if (user.activeMode !== 'dapper') {
      stopDapperLocationStream(user.id, 'Dapper went offline.');
    }

    response.status(200).json({ user: serializeUser(user) });
  } catch (error) {
    console.error('Unable to complete onboarding:', error);
    response.status(500).json({ message: 'Unable to save setup choice.' });
  }
});

app.patch('/auth/mode', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  const body: unknown = request.body;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('mode' in body) ||
    !isAppMode(body.mode)
  ) {
    response.status(400).json({
      message: "Mode must be 'order' or 'dapper'.",
    });
    return;
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    user.activeMode = body.mode;
    user.hasCompletedOnboarding = true;
    user.onboardingCompletedAt ??= new Date();

    await user.save();
    if (user.activeMode !== 'dapper') {
      stopDapperLocationStream(user.id, 'Dapper went offline.');
    }

    response.status(200).json({ user: serializeUser(user) });
  } catch (error) {
    console.error('Unable to update mode:', error);
    response.status(500).json({ message: 'Unable to switch mode.' });
  }
});

app.delete('/auth/account', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  try {
    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    stopDapperLocationStream(userId, 'Account deleted.');
    response.status(204).end();
  } catch (error) {
    console.error('Unable to delete user account:', error);
    response.status(500).json({ message: 'Unable to delete account.' });
  }
});

type Credentials = {
  username: string;
  password: string;
};

type DapperSocketState = {
  getUserId: () => string | null;
  setUserId: (userId: string) => void;
  isAuthenticating: () => boolean;
  setAuthenticating: (value: boolean) => void;
};

async function handleDapperSocketMessage(
  socket: WebSocket,
  message: Record<string, unknown>,
  state: DapperSocketState,
): Promise<void> {
  const userId = state.getUserId();

  if (!userId) {
    if (state.isAuthenticating()) {
      socket.close(1008, 'Authentication is already in progress.');
      return;
    }

    if (message.type !== 'authenticate' || typeof message.token !== 'string') {
      socket.close(1008, 'Authentication is required.');
      return;
    }

    const tokenUserId = getTokenUserId(message.token);

    if (!tokenUserId) {
      socket.close(1008, 'Invalid authentication token.');
      return;
    }

    state.setAuthenticating(true);
    const user = await User.findById(tokenUserId).select('activeMode');

    if (!user || user.activeMode !== 'dapper') {
      socket.close(1008, 'Only dapper mode can stream location.');
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const previousConnection = activeDappers.get(user.id);
    previousConnection?.socket.close(4001, 'Replaced by a newer connection.');
    state.setUserId(user.id);
    activeDappers.set(user.id, { socket, location: null });
    socket.send(JSON.stringify({ type: 'authenticated' }));
    return;
  }

  if (message.type === 'offline') {
    removeActiveDapper(userId, socket);
    socket.close(1000, 'Dapper went offline.');
    return;
  }

  if (
    message.type !== 'location' ||
    typeof message.latitude !== 'number' ||
    typeof message.longitude !== 'number' ||
    !Number.isFinite(message.latitude) ||
    !Number.isFinite(message.longitude) ||
    message.latitude < -90 ||
    message.latitude > 90 ||
    message.longitude < -180 ||
    message.longitude > 180
  ) {
    socket.close(1008, 'Invalid location message.');
    return;
  }

  const activeDapper = activeDappers.get(userId);

  if (!activeDapper || activeDapper.socket !== socket) {
    socket.close(1008, 'Dapper location stream is not active.');
    return;
  }

  activeDapper.location = {
    latitude: message.latitude,
    longitude: message.longitude,
    updatedAt: Date.now(),
  };
}

function getTokenUserId(token: string): string | null {
  try {
    const payload = jwt.verify(token, jwtSecret);

    return typeof payload === 'object' &&
      payload !== null &&
      typeof payload.sub === 'string'
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

type SerializedUser = {
  id: string;
  username: string;
  authProvider: AuthProvider;
  chessUsername: string | null;
  chessAvatar: string | null;
  activeMode: AppMode;
  hasCompletedOnboarding: boolean;
};

function authenticateRequest(
  request: Request,
  response: Response,
): string | null {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ message: 'Authentication is required.' });
    return null;
  }

  try {
    const userId = getTokenUserId(authorization.slice(7));
    if (!userId) {
      response.status(401).json({ message: 'Invalid authentication token.' });
      return null;
    }

    return userId;
  } catch {
    response.status(401).json({ message: 'Invalid authentication token.' });
    return null;
  }
}

function serializeUser(user: {
  id: string;
  username: string;
  authProvider?: AuthProvider;
  chessUsername?: string | null;
  chessAvatar?: string | null;
  activeMode?: AppMode;
  hasCompletedOnboarding?: boolean;
}): SerializedUser {
  return {
    id: user.id,
    username: user.username,
    authProvider: user.authProvider === 'chess' ? 'chess' : 'local',
    chessUsername: user.chessUsername ?? null,
    chessAvatar: user.chessAvatar ?? null,
    activeMode: user.activeMode === 'dapper' ? 'dapper' : 'order',
    hasCompletedOnboarding: Boolean(user.hasCompletedOnboarding),
  };
}

function isAppMode(value: unknown): value is AppMode {
  return value === 'order' || value === 'dapper';
}

function removeActiveDapper(userId: string, socket: WebSocket): void {
  const activeDapper = activeDappers.get(userId);

  if (activeDapper?.socket === socket) {
    activeDappers.delete(userId);
  }
}

function stopDapperLocationStream(userId: string, reason: string): void {
  const activeDapper = activeDappers.get(userId);
  activeDappers.delete(userId);
  activeDapper?.socket.close(1008, reason);
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} must be set.`);
  }

  return value;
}

function readCredentials(
  request: Request,
  response: Response,
): Credentials | null {
  const body: unknown = request.body;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('username' in body) ||
    !('password' in body) ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string'
  ) {
    response.status(400).json({ message: 'Username and password are required.' });
    return null;
  }

  const username = body.username.trim().toLowerCase();
  const password = body.password;

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    response.status(400).json({
      message: 'Username must be 3-30 letters, numbers, or underscores.',
    });
    return null;
  }

  if (password.length < 8 || password.length > 128) {
    response
      .status(400)
      .json({ message: 'Password must be between 8 and 128 characters.' });
    return null;
  }

  return { username, password };
}

function signUserToken(user: SerializedUser): string {
  return jwt.sign(
    { sub: user.id, username: user.username },
    jwtSecret,
    { expiresIn: 60 * 60 * 24 * 7 },
  );
}

function sendAuthResponse(response: Response, user: SerializedUser) {
  const token = signUserToken(user);
  response.status(200).json({ token, user });
}

function isValidHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isHttpUrl(rawUrl: string): boolean {
  return isValidHttpUrl(rawUrl) !== null;
}

function resolveChessRedirectUri(
  request: Request,
  requestedRedirectUri?: unknown,
): string {
  const configured = process.env.CHESS_OAUTH_REDIRECT_URI?.trim();
  let canonicalUrl: URL | null = null;

  if (configured) {
    canonicalUrl = isValidHttpUrl(configured);
    if (!canonicalUrl) {
      throw new ChessOAuthConfigError(
        'CHESS_OAUTH_REDIRECT_URI must be a valid http(s) URL.',
      );
    }
  } else {
    const publicBackendUrl = process.env.PUBLIC_BACKEND_URL?.trim();
    if (publicBackendUrl) {
      const parsedPublic = isValidHttpUrl(publicBackendUrl);
      if (!parsedPublic) {
        throw new ChessOAuthConfigError(
          'PUBLIC_BACKEND_URL must be a valid http(s) URL.',
        );
      }
      canonicalUrl = new URL(
        `${parsedPublic.toString().replace(/\/+$/, '')}/auth/chess/callback`,
      );
    } else {
      const forwardedProto = request
        .get('x-forwarded-proto')
        ?.split(',')[0]
        ?.trim();
      const protocol = forwardedProto || request.protocol || 'http';
      const host =
        request.get('x-forwarded-host')?.split(',')[0]?.trim() ||
        request.get('host') ||
        `localhost:${port}`;

      canonicalUrl = isValidHttpUrl(`${protocol}://${host}/auth/chess/callback`);
      if (!canonicalUrl) {
        throw new ChessOAuthFlowError(
          'Unable to resolve a valid Chess.com OAuth callback URL.',
          400,
        );
      }
    }
  }

  if (requestedRedirectUri !== undefined && requestedRedirectUri !== null) {
    if (typeof requestedRedirectUri !== 'string') {
      throw new ChessOAuthFlowError(
        'Chess.com OAuth redirectUri must be a valid URL string.',
        400,
      );
    }

    const trimmed = requestedRedirectUri.trim();
    if (trimmed.length > 0) {
      const parsedRequested = isValidHttpUrl(trimmed);
      if (!parsedRequested) {
        throw new ChessOAuthFlowError(
          'Chess.com OAuth redirectUri must be a valid http(s) URL.',
          400,
        );
      }

      if (
        parsedRequested.origin !== canonicalUrl.origin ||
        parsedRequested.pathname !== canonicalUrl.pathname ||
        parsedRequested.search !== canonicalUrl.search ||
        parsedRequested.hash !== canonicalUrl.hash
      ) {
        throw new ChessOAuthFlowError(
          'Chess.com OAuth redirectUri does not match the configured callback URL.',
          400,
        );
      }

      return parsedRequested.toString();
    }
  }

  return canonicalUrl.toString();
}

function resolveSafeReturnTo(rawReturnTo: string | null): string | null {
  if (!rawReturnTo) {
    return null;
  }

  try {
    const parsed = new URL(rawReturnTo);
    const configuredFrontend = process.env.FRONTEND_ORIGIN?.trim();

    if (configuredFrontend) {
      try {
        const allowedOrigin = new URL(configuredFrontend).origin;
        if (parsed.origin === allowedOrigin) {
          return parsed.toString();
        }
      } catch {
        // Ignore malformed FRONTEND_ORIGIN when checking origin match.
      }
    }

    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return parsed.toString();
    }

    if (parsed.protocol === 'uberdaps:' || parsed.protocol === 'exp:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function buildNativeChessDeepLink(
  returnTo: string | null,
  params: Record<string, string>,
): string {
  const baseUrl =
    returnTo && !isHttpUrl(returnTo) ? returnTo : 'uberdaps://auth/chess';
  const target = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

function sendChessCallbackError(
  response: Response,
  returnTo: string | null,
  message: string,
): void {
  if (returnTo && isHttpUrl(returnTo)) {
    const target = new URL(returnTo);
    target.searchParams.set('chess_error', message);
    response.redirect(302, target.toString());
    return;
  }

  const deepLinkTarget = buildNativeChessDeepLink(returnTo, {
    chess_error: message,
  });

  response
    .status(400)
    .type('html')
    .send(
      renderChessCallbackHtml(
        'Chess.com Sign-In Failed',
        message,
        deepLinkTarget,
      ),
    );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChessCallbackHtml(
  title: string,
  message: string,
  deepLinkUrl: string,
): string {
  const safeDeepLinkJson = JSON.stringify(deepLinkUrl)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f9fafc; color: #172033; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { max-width: 400px; background: #ffffff; border-radius: 16px; padding: 28px; box-shadow: 0 10px 30px rgba(23, 32, 51, 0.12); text-align: center; }
      h1 { font-size: 20px; margin: 0 0 10px; }
      p { font-size: 15px; line-height: 1.5; color: #4a5568; margin: 0 0 20px; }
      .button { display: inline-block; padding: 12px 20px; border-radius: 10px; background: #172033; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="button" href="${escapeHtml(deepLinkUrl)}">Return to UberDaps</a>
    </div>
    <script>
      setTimeout(function () {
        window.location.href = ${safeDeepLinkJson};
      }, 150);
    </script>
  </body>
</html>`;
}

function sanitizeBaseUsername(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  if (cleaned.length >= 2) {
    return cleaned;
  }

  return 'chess_player';
}

async function findOrCreateChessUser(profile: ChessUserProfile) {
  let user = await User.findOne({ chessId: profile.chessId });

  if (!user) {
    user = await User.findOne({
      authProvider: 'chess',
      chessUsername: profile.chessUsername,
      $or: [{ chessId: null }, { chessId: { $exists: false } }],
    });
  }

  if (user) {
    let dirty = false;
    if (!user.chessId) {
      user.chessId = profile.chessId;
      dirty = true;
    }
    if (user.chessUsername !== profile.chessUsername) {
      user.chessUsername = profile.chessUsername;
      dirty = true;
    }
    if (profile.chessAvatar && user.chessAvatar !== profile.chessAvatar) {
      user.chessAvatar = profile.chessAvatar;
      dirty = true;
    }
    if (dirty) {
      await user.save();
    }
    return user;
  }

  const baseUsername = sanitizeBaseUsername(profile.chessUsername);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix =
      attempt === 0 ? '' : attempt === 1 ? '_chess' : `_chess_${attempt}`;
    const maxBaseLength = 40 - suffix.length;
    const candidate = `${baseUsername.slice(0, maxBaseLength)}${suffix}`;

    try {
      return await User.create({
        username: candidate,
        authProvider: 'chess',
        chessId: profile.chessId,
        chessUsername: profile.chessUsername,
        chessAvatar: profile.chessAvatar,
        activeMode: 'order',
        hasCompletedOnboarding: false,
      });
    } catch (error) {
      if (isDuplicateUsernameError(error)) {
        const existingByChessId = await User.findOne({
          chessId: profile.chessId,
        });
        if (existingByChessId) {
          return existingByChessId;
        }
        continue;
      }
      throw error;
    }
  }

  const randomSuffix = `_${Date.now().toString(36)}`;
  const fallbackUsername = `${baseUsername.slice(0, 40 - randomSuffix.length)}${randomSuffix}`;

  return User.create({
    username: fallbackUsername,
    authProvider: 'chess',
    chessId: profile.chessId,
    chessUsername: profile.chessUsername,
    chessAvatar: profile.chessAvatar,
    activeMode: 'order',
    hasCompletedOnboarding: false,
  });
}

function isDuplicateUsernameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function startServer() {
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  server.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

void startServer().catch((error: unknown) => {
  console.error('Unable to start backend:', error);
  process.exitCode = 1;
});
