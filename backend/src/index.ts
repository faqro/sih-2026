import 'dotenv/config';

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';

import {
  SteamAuthConfigError,
  SteamAuthFlowError,
  cancelSteamAuthSession,
  completeSteamSessionWithCode,
  consumeExchangeCode,
  createExchangeCode,
  createSteamAuthorizationSession,
  getSteamAuthSession,
  getSteamAuthSessionForPoll,
  markSteamSessionError,
  verifySteamOpenIdCallback,
  type SteamUserProfile,
} from './steamAuth.js';
import {
  StravaAuthConfigError,
  StravaAuthFlowError,
  cancelStravaAuthSession,
  completeStravaSessionWithCode,
  getStravaAuthSession,
  getStravaAuthSessionForPoll,
  markStravaSessionError,
  verifyStravaOAuthCallback,
  createStravaAuthorizationSession,
  type StravaUserProfile,
} from './stravaAuth.js';
import { DapRating } from './models/DapRating.js';
import {
  DAP_SERVICES,
  User,
  type AppMode,
  type AuthProvider,
  type DapService,
} from './models/User.js';

type Coordinates = {
  latitude: number;
  longitude: number;
};

type ActiveDapper = {
  username: string;
  name: string | null;
  offeredServices: DapService[];
  crispinessRatingTotal: number;
  crispinessRatingCount: number;
  socket: WebSocket | null;
  location: Coordinates | null;
  lastLocationAt: number;
  pendingOfferId: string | null;
  activeRequestId: string | null;
};

type DapRequest = {
  id: string;
  userId: string;
  username: string;
  userSocket: WebSocket | null;
  service: DapService;
  location: Coordinates;
  createdAt: number;
  deadlineAt: number;
  status: 'pending' | 'matched';
  declinedDapperIds: Set<string>;
  offeredDapperId: string | null;
  dapperId: string | null;
  timeout: ReturnType<typeof setTimeout> | null;
  offerTimeout: ReturnType<typeof setTimeout> | null;
  disconnectTimeout: ReturnType<typeof setTimeout> | null;
};

type SocketSession = {
  userId: string | null;
  username: string | null;
  activeMode: AppMode | null;
  isAuthenticating: boolean;
};

const app = express();
const server = createServer(app);
const webSocketServer = new WebSocketServer({
  maxPayload: 4096,
  noServer: true,
});
const port = Number(process.env.PORT ?? 3000);
const mongoUri = requireEnvironmentVariable('MONGODB_URI');
const jwtSecret = requireEnvironmentVariable('JWT_SECRET');
const activeDappers = new Map<string, ActiveDapper>();
const activeUserSockets = new Map<string, WebSocket>();
const dapRequests = new Map<string, DapRequest>();
const activeRequestIdsByUser = new Map<string, string>();
const DAPPER_LOCATION_STALE_AFTER_MS = 180_000;
const WS_HEARTBEAT_INTERVAL_MS = 20_000;
const ORDER_DISCONNECT_GRACE_MS = 15_000;
const socketAliveState = new WeakMap<WebSocket, boolean>();

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
  socketAliveState.set(socket, true);
  const session: SocketSession = {
    userId: null,
    username: null,
    activeMode: null,
    isAuthenticating: false,
  };

  socket.on('pong', () => {
    socketAliveState.set(socket, true);
    if (session.userId && session.activeMode === 'dapper') {
      const dapper = activeDappers.get(session.userId);
      if (dapper && dapper.socket === socket && dapper.location !== null) {
        dapper.lastLocationAt = Date.now();
      }
    }
  });

  socket.on('message', (data, isBinary) => {
    socketAliveState.set(socket, true);
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

    void handleRealtimeMessage(socket, message, session).catch(
      (error: unknown) => {
      console.error('Unable to process dapper location message:', error);
      socket.close(1011, 'Unable to process message.');
      },
    );
  });

  socket.on('close', () => {
    if (session.userId && session.activeMode === 'dapper') {
      handleDapperSocketDisconnect(session.userId, socket);
    } else if (session.userId && session.activeMode === 'order') {
      handleOrderSocketDisconnect(session.userId, socket);
    }
  });

  socket.on('error', (error) => {
    console.error('Dapper location WebSocket error:', error);
  });
});

const webSocketHeartbeatInterval = setInterval(() => {
  for (const socket of webSocketServer.clients) {
    if (socketAliveState.get(socket) === false) {
      socket.terminate();
      continue;
    }

    socketAliveState.set(socket, false);
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }
}, WS_HEARTBEAT_INTERVAL_MS);

webSocketServer.on('close', () => {
  clearInterval(webSocketHeartbeatInterval);
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
    const hashedPassword = await hashPassword(credentials.password);
    const user = await User.create({
      username: credentials.username,
      password: hashedPassword,
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

    if (user.authProvider !== 'local' || !user.password) {
      const provider =
        user.authProvider === 'strava' ? 'Strava' : 'Steam';
      response.status(400).json({
        message: `This account uses ${provider} Sign-In. Please tap "Continue with ${provider}".`,
      });
      return;
    }

    const passwordVerification = await verifyPassword(
      credentials.password,
      user.password,
    );

    if (!passwordVerification.valid) {
      response.status(401).json({
        message: 'Incorrect password.',
      });
      return;
    }

    if (passwordVerification.needsRehash) {
      user.password = await hashPassword(credentials.password);
      await user.save();
    }

    sendAuthResponse(response, serializeUser(user));
  } catch (error) {
    console.error('Unable to sign in:', error);
    response.status(500).json({ message: 'Unable to sign in.' });
  }
});

app.post('/auth/steam/start', (request, response) => {
  const body: unknown = request.body;
  const rawReturnTo =
    isRecord(body) && typeof body.returnTo === 'string' ? body.returnTo : null;
  const requestedRedirectUri =
    isRecord(body) && 'redirectUri' in body ? body.redirectUri : undefined;
  const returnTo = resolveSafeReturnTo(rawReturnTo);

  try {
    const callbackBaseUrl = resolveSteamRedirectUri(
      request,
      requestedRedirectUri,
    );
    const session = createSteamAuthorizationSession({
      callbackBaseUrl,
      returnTo,
    });
    response.status(200).json(session);
  } catch (error) {
    if (error instanceof SteamAuthConfigError) {
      response.status(503).json({ message: error.message });
      return;
    }

    if (error instanceof SteamAuthFlowError) {
      response.status(error.status).json({ message: error.message });
      return;
    }

    console.error('Unable to start Steam SSO:', error);
    response.status(500).json({ message: 'Unable to start Steam Sign-In.' });
  }
});

app.get('/auth/steam/callback', async (request, response) => {
  const state =
    typeof request.query.state === 'string' ? request.query.state : '';

  const existingSession = state ? getSteamAuthSession(state) : null;
  const fallbackReturnTo = resolveSafeReturnTo(existingSession?.returnTo ?? null);

  if (!state) {
    const message = 'Missing Steam sign-in state parameter.';
    sendSteamCallbackError(response, fallbackReturnTo, message);
    return;
  }

  try {
    const { profile, session } = await verifySteamOpenIdCallback({
      state,
      query: request.query as Record<string, unknown>,
    });
    if (session.status !== 'pending') {
      throw new SteamAuthFlowError('Steam sign-in was cancelled.', 400);
    }

    const user = await findOrCreateSteamUser(profile);
    const serialized = serializeUser(user);
    const token = signUserToken(serialized);
    const exchangeCode = createExchangeCode(token, serialized);

    if (!completeSteamSessionWithCode(state, exchangeCode)) {
      consumeExchangeCode(exchangeCode);
      throw new SteamAuthFlowError('Steam sign-in was cancelled.', 400);
    }

    const targetReturnTo = resolveSafeReturnTo(session.returnTo);
    if (targetReturnTo && isHttpUrl(targetReturnTo)) {
      const redirectTarget = new URL(targetReturnTo);
      redirectTarget.searchParams.set('steam_code', exchangeCode);
      response.redirect(302, redirectTarget.toString());
      return;
    }

    const deepLinkTarget = buildNativeSteamDeepLink(targetReturnTo, {
      steam_code: exchangeCode,
    });

    response
      .status(200)
      .type('html')
      .send(
        renderSteamCallbackHtml(
          'Signed in with Steam',
          'Returning you to UberDaps. Tap the button below if the app does not open automatically.',
          deepLinkTarget,
        ),
      );
  } catch (error) {
    const message =
      error instanceof SteamAuthConfigError ||
      error instanceof SteamAuthFlowError
        ? error.message
        : 'Unable to complete Steam Sign-In.';

    console.error('Steam SSO callback error:', error);
    markSteamSessionError(state, message);
    sendSteamCallbackError(response, fallbackReturnTo, message);
  }
});

app.post('/auth/steam/exchange', (request, response) => {
  const body: unknown = request.body;

  if (
    !isRecord(body) ||
    typeof body.code !== 'string' ||
    body.code.trim().length === 0
  ) {
    response.status(400).json({ message: 'Steam exchange code is required.' });
    return;
  }

  const payload = consumeExchangeCode<SerializedUser>(body.code.trim());

  if (!payload) {
    response.status(401).json({
      message: 'Steam sign-in session expired. Please try again.',
    });
    return;
  }

  response.status(200).json(payload);
});

app.get('/auth/steam/status', (request, response) => {
  const state =
    typeof request.query.state === 'string' ? request.query.state.trim() : '';
  const queryPollToken =
    typeof request.query.pollToken === 'string'
      ? request.query.pollToken.trim()
      : '';
  const headerPollToken =
    request.get('x-steam-poll-token')?.trim() || '';
  const pollToken = queryPollToken || headerPollToken;

  if (!state || !pollToken) {
    response.status(400).json({ message: 'Missing Steam state or pollToken.' });
    return;
  }

  const lookup = getSteamAuthSessionForPoll(state, pollToken);

  if (lookup.kind === 'expired') {
    response.status(200).json({
      status: 'expired',
      message: 'Steam sign-in session expired. Please try again.',
    });
    return;
  }

  if (lookup.kind === 'unauthorized') {
    response.status(403).json({
      message: 'Invalid Steam sign-in poll token.',
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
      message: session.errorMessage || 'Steam sign-in was cancelled.',
    });
    return;
  }

  if (session.status === 'error') {
    response.status(200).json({
      status: 'error',
      message: session.errorMessage || 'Steam sign-in failed.',
    });
    return;
  }

  response.status(200).json({ status: 'pending' });
});

app.post('/auth/steam/cancel', (request, response) => {
  const body: unknown = request.body;

  if (
    !isRecord(body) ||
    typeof body.state !== 'string' ||
    body.state.trim().length === 0 ||
    typeof body.pollToken !== 'string' ||
    body.pollToken.trim().length === 0
  ) {
    response.status(400).json({
      message: 'Steam sign-in state and pollToken are required.',
    });
    return;
  }

  const result = cancelSteamAuthSession(
    body.state.trim(),
    body.pollToken.trim(),
  );

  if (result.kind === 'expired') {
    response.status(200).json({ status: 'expired', cancelled: false });
    return;
  }

  if (result.kind === 'unauthorized') {
    response.status(403).json({
      message: 'Invalid Steam sign-in poll token.',
    });
    return;
  }

  response.status(200).json({
    status: result.status,
    cancelled: result.cancelled,
  });
});

app.post('/auth/strava/start', (request, response) => {
  const body: unknown = request.body;
  const rawReturnTo =
    isRecord(body) && typeof body.returnTo === 'string' ? body.returnTo : null;
  const returnTo = resolveSafeReturnTo(rawReturnTo);

  try {
    const redirectUri = resolveStravaRedirectUri(request);
    const session = createStravaAuthorizationSession({ redirectUri, returnTo });
    response.status(200).json(session);
  } catch (error) {
    if (error instanceof StravaAuthConfigError) {
      response.status(503).json({ message: error.message });
      return;
    }
    if (error instanceof StravaAuthFlowError) {
      response.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Unable to start Strava SSO:', error);
    response.status(500).json({ message: 'Unable to start Strava Sign-In.' });
  }
});

app.get('/auth/strava/callback', async (request, response) => {
  const state =
    typeof request.query.state === 'string' ? request.query.state : '';
  const existingSession = state ? getStravaAuthSession(state) : null;
  const fallbackReturnTo = resolveSafeReturnTo(existingSession?.returnTo ?? null);
  const callbackError =
    typeof request.query.error === 'string' ? request.query.error : '';

  if (callbackError) {
    const message =
      callbackError === 'access_denied'
        ? 'Strava sign-in was cancelled.'
        : 'Strava authorization failed.';
    markStravaSessionError(state, message);
    sendStravaCallbackError(response, fallbackReturnTo, message);
    return;
  }
  if (!state) {
    const message = 'Missing Strava sign-in state parameter.';
    sendStravaCallbackError(response, fallbackReturnTo, message);
    return;
  }

  try {
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (!code) {
      throw new StravaAuthFlowError(
        'Strava did not return an authorization code.',
        400,
      );
    }
    const { profile, session } = await verifyStravaOAuthCallback({
      state,
      code,
      scope: typeof request.query.scope === 'string' ? request.query.scope : '',
    });
    if (session.status !== 'pending') {
      throw new StravaAuthFlowError('Strava sign-in was cancelled.', 400);
    }

    const user = await findOrCreateStravaUser(profile);
    const serialized = serializeUser(user);
    const token = signUserToken(serialized);
    const exchangeCode = createExchangeCode(token, serialized);
    if (!completeStravaSessionWithCode(state, exchangeCode)) {
      consumeExchangeCode(exchangeCode);
      throw new StravaAuthFlowError('Strava sign-in was cancelled.', 400);
    }

    const targetReturnTo = resolveSafeReturnTo(session.returnTo);
    if (targetReturnTo && isHttpUrl(targetReturnTo)) {
      const redirectTarget = new URL(targetReturnTo);
      redirectTarget.searchParams.set('strava_code', exchangeCode);
      response.redirect(302, redirectTarget.toString());
      return;
    }

    const deepLinkTarget = buildNativeStravaDeepLink(targetReturnTo, {
      strava_code: exchangeCode,
    });
    response
      .status(200)
      .type('html')
      .send(
        renderSteamCallbackHtml(
          'Signed in with Strava',
          'Returning you to UberDaps. Tap the button below if the app does not open automatically.',
          deepLinkTarget,
        ),
      );
  } catch (error) {
    const message =
      error instanceof StravaAuthConfigError ||
      error instanceof StravaAuthFlowError
        ? error.message
        : 'Unable to complete Strava Sign-In.';
    console.error('Strava SSO callback error:', error);
    markStravaSessionError(state, message);
    sendStravaCallbackError(response, fallbackReturnTo, message);
  }
});

app.post('/auth/strava/exchange', (request, response) => {
  const body: unknown = request.body;
  if (
    !isRecord(body) ||
    typeof body.code !== 'string' ||
    body.code.trim().length === 0
  ) {
    response.status(400).json({ message: 'Strava exchange code is required.' });
    return;
  }
  const payload = consumeExchangeCode<SerializedUser>(body.code.trim());
  if (!payload) {
    response.status(401).json({
      message: 'Strava sign-in session expired. Please try again.',
    });
    return;
  }
  response.status(200).json(payload);
});

app.get('/auth/strava/status', (request, response) => {
  const state =
    typeof request.query.state === 'string' ? request.query.state.trim() : '';
  const pollToken =
    typeof request.query.pollToken === 'string'
      ? request.query.pollToken.trim()
      : request.get('x-strava-poll-token')?.trim() || '';
  if (!state || !pollToken) {
    response.status(400).json({ message: 'Missing Strava state or pollToken.' });
    return;
  }
  const lookup = getStravaAuthSessionForPoll(state, pollToken);
  if (lookup.kind === 'expired') {
    response.status(200).json({
      status: 'expired',
      message: 'Strava sign-in session expired. Please try again.',
    });
    return;
  }
  if (lookup.kind === 'unauthorized') {
    response.status(403).json({ message: 'Invalid Strava sign-in poll token.' });
    return;
  }
  const { session } = lookup;
  if (session.status === 'completed' && session.exchangeCode) {
    response.status(200).json({ status: 'completed', code: session.exchangeCode });
    return;
  }
  if (session.status === 'cancelled' || session.status === 'error') {
    response.status(200).json({
      status: session.status,
      message: session.errorMessage || 'Strava sign-in failed.',
    });
    return;
  }
  response.status(200).json({ status: 'pending' });
});

app.post('/auth/strava/cancel', (request, response) => {
  const body: unknown = request.body;
  if (
    !isRecord(body) ||
    typeof body.state !== 'string' ||
    body.state.trim().length === 0 ||
    typeof body.pollToken !== 'string' ||
    body.pollToken.trim().length === 0
  ) {
    response.status(400).json({
      message: 'Strava sign-in state and pollToken are required.',
    });
    return;
  }
  const result = cancelStravaAuthSession(
    body.state.trim(),
    body.pollToken.trim(),
  );
  if (result.kind === 'expired') {
    response.status(200).json({ status: 'expired', cancelled: false });
    return;
  }
  if (result.kind === 'unauthorized') {
    response.status(403).json({ message: 'Invalid Strava sign-in poll token.' });
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

app.patch('/auth/profile', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  const body: unknown = request.body;
  if (!isRecord(body)) {
    response.status(400).json({ message: 'Invalid profile update payload.' });
    return;
  }

  const hasName = 'name' in body;
  const hasUsername = 'username' in body;
  const hasNewPassword =
    'newPassword' in body &&
    typeof body.newPassword === 'string' &&
    body.newPassword.length > 0;

  if (!hasName && !hasUsername && !hasNewPassword) {
    response.status(400).json({
      message: 'Provide a name, username, or new password to update.',
    });
    return;
  }

  let nextName: string | null | undefined;
  if (hasName) {
    if (body.name !== null && typeof body.name !== 'string') {
      response.status(400).json({ message: 'Name must be a valid string.' });
      return;
    }
    const trimmedName = body.name === null ? '' : body.name.trim();
    if (trimmedName.length > 60) {
      response.status(400).json({
        message: 'Name must be 60 characters or fewer.',
      });
      return;
    }
    nextName = trimmedName.length > 0 ? trimmedName : null;
  }

  let nextUsername: string | undefined;
  if (hasUsername) {
    if (typeof body.username !== 'string') {
      response.status(400).json({ message: 'Username must be a string.' });
      return;
    }
    const normalizedUsername = body.username.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,30}$/.test(normalizedUsername)) {
      response.status(400).json({
        message:
          'Username must be 3-30 letters, numbers, underscores, or hyphens.',
      });
      return;
    }
    nextUsername = normalizedUsername;
  }

  const newPassword = hasNewPassword ? (body.newPassword as string) : undefined;
  if (
    newPassword !== undefined &&
    (newPassword.length < 8 || newPassword.length > 128)
  ) {
    response.status(400).json({
      message: 'New password must be between 8 and 128 characters.',
    });
    return;
  }

  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';

  try {
    const user = await User.findById(userId).select('+password');

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    const isChangingUsername =
      nextUsername !== undefined && nextUsername !== user.username;
    const isLocalAccount = user.authProvider === 'local';

    if (hasNewPassword && (!isLocalAccount || !user.password)) {
      const provider = user.authProvider === 'strava' ? 'Strava' : 'Steam';
      response.status(400).json({
        message: `Password changes are not available for ${provider} Sign-In accounts.`,
      });
      return;
    }

    if (
      (hasNewPassword || (isChangingUsername && isLocalAccount && user.password))
    ) {
      if (!currentPassword) {
        response.status(401).json({
          message:
            'Enter your current password to update your username or password.',
        });
        return;
      }

      if (!user.password) {
        response.status(401).json({
          message: 'Current password verification failed.',
        });
        return;
      }

      const verification = await verifyPassword(currentPassword, user.password);
      if (!verification.valid) {
        response.status(401).json({
          message: 'Current password is incorrect.',
        });
        return;
      }
    }

    if (newPassword !== undefined && currentPassword === newPassword) {
      response.status(400).json({
        message: 'New password must be different from your current password.',
      });
      return;
    }

    if (isChangingUsername && nextUsername) {
      const existingUser = await User.exists({
        username: nextUsername,
        _id: { $ne: user._id },
      });
      if (existingUser) {
        response.status(409).json({ message: 'This username is already taken.' });
        return;
      }
      user.username = nextUsername;
    }

    if (nextName !== undefined) {
      user.name = nextName;
    }

    if (newPassword !== undefined) {
      user.password = await hashPassword(newPassword);
    }

    await user.save();

    const liveDapper = activeDappers.get(user.id);
    if (liveDapper) {
      liveDapper.username = user.username;
      liveDapper.name = user.name ?? null;
    }

    const activeRequestId = activeRequestIdsByUser.get(user.id);
    const activeRequest = activeRequestId
      ? dapRequests.get(activeRequestId)
      : undefined;
    if (activeRequest) {
      activeRequest.username = user.username;
    }

    sendAuthResponse(response, serializeUser(user));
  } catch (error) {
    if (isDuplicateUsernameError(error)) {
      response.status(409).json({ message: 'This username is already taken.' });
      return;
    }

    console.error('Unable to update user profile:', error);
    response.status(500).json({ message: 'Unable to update profile.' });
  }
});

app.get('/auth/ratings', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  try {
    const user = await User.findById(userId).select(
      'crispinessRatingTotal crispinessRatingCount',
    );

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    const [breakdownRows, recentDocs] = await Promise.all([
      DapRating.aggregate<{ _id: number; count: number }>([
        { $match: { dapperId: userId, rating: { $gte: 1, $lte: 5 } } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
      DapRating.find({ dapperId: userId, rating: { $ne: null } })
        .sort({ ratedAt: -1, updatedAt: -1 })
        .limit(25)
        .lean(),
    ]);

    const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };
    let ratedDocsCount = 0;
    let ratedDocsSum = 0;

    for (const row of breakdownRows) {
      if (row._id >= 1 && row._id <= 5) {
        const star = row._id as 1 | 2 | 3 | 4 | 5;
        breakdown[star] = row.count;
        ratedDocsCount += row.count;
        ratedDocsSum += star * row.count;
      }
    }

    const raterIds = [
      ...new Set(
        recentDocs
          .map((doc) => doc.userId)
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ];
    const raterUsers = raterIds.length
      ? await User.find({ _id: { $in: raterIds } })
          .select('name username steamUsername stravaUsername')
          .lean()
      : [];
    const raterMap = new Map(
      raterUsers.map((rater) => [
        String(rater._id),
        rater.name || rater.steamUsername || rater.stravaUsername || rater.username,
      ]),
    );

    const totalRatings =
      user.crispinessRatingCount > 0 ? user.crispinessRatingCount : ratedDocsCount;
    const totalScore =
      user.crispinessRatingCount > 0 ? user.crispinessRatingTotal : ratedDocsSum;
    const averageRating =
      totalRatings > 0 ? Number((totalScore / totalRatings).toFixed(2)) : null;

    const recentRatings = recentDocs
      .filter((doc): doc is typeof doc & { rating: number } => typeof doc.rating === 'number')
      .map((doc) => ({
        id: String(doc._id),
        requestId: doc.requestId,
        rating: doc.rating,
        comment: doc.comment ?? null,
        service: doc.service ?? null,
        raterName:
          raterMap.get(doc.userId) ?? doc.raterUsername ?? 'UberDaps Rider',
        ratedAt: (doc.ratedAt ?? new Date()).toISOString(),
      }));

    response.status(200).json({
      averageRating,
      totalRatings,
      breakdown,
      recentRatings,
    });
  } catch (error) {
    console.error('Unable to load dapper ratings:', error);
    response.status(500).json({ message: 'Unable to load ratings.' });
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
  const offeredServicesInput =
    'offeredServices' in body ? body.offeredServices : undefined;
  const hasMode = modeInput !== undefined;
  const hasSkip = 'skip' in body && body.skip === true;

  if (hasMode && !isAppMode(modeInput)) {
    response.status(400).json({
      message: "Mode must be 'order' or 'dapper'.",
    });
    return;
  }

  let offeredServices: DapService[] | null = null;
  if (modeInput === 'dapper') {
    offeredServices = readDapServices(offeredServicesInput);
    if (!offeredServices) {
      response.status(400).json({
        message: 'Select at least one dapper service.',
      });
      return;
    }
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
      if (modeInput === 'dapper' && offeredServices) {
        user.offeredServices = offeredServices;
      }
    } else if (!user.hasCompletedOnboarding) {
      // Preserve an existing mode if onboarding was already finished earlier.
      user.activeMode = 'order';
    }

    user.hasCompletedOnboarding = true;
    user.onboardingCompletedAt ??= new Date();

    await user.save();
    if (user.activeMode !== 'dapper') {
      stopDapperLocationStream(user.id, 'Dapper went offline.');
    } else {
      stopOrderLocationStream(user.id, 'Dapper mode selected.');
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

    if (body.mode === 'dapper' && !user.offeredServices?.length) {
      response.status(400).json({
        message: 'Select at least one dapper service in Preferences first.',
      });
      return;
    }

    if (body.mode !== user.activeMode) {
      const requestId = activeRequestIdsByUser.get(userId);
      const activeRequest = requestId
        ? dapRequests.get(requestId)
        : undefined;
      const activeDapper = activeDappers.get(userId);

      if (activeRequest?.status === 'matched' || activeDapper?.activeRequestId) {
        response.status(409).json({
          message: 'Finish your active UberDap before switching modes.',
        });
        return;
      }
    }

    user.activeMode = body.mode;
    user.hasCompletedOnboarding = true;
    user.onboardingCompletedAt ??= new Date();

    await user.save();
    if (user.activeMode !== 'dapper') {
      stopDapperLocationStream(user.id, 'Dapper went offline.');
    } else {
      stopOrderLocationStream(user.id, 'Dapper mode selected.');
    }

    response.status(200).json({ user: serializeUser(user) });
  } catch (error) {
    console.error('Unable to update mode:', error);
    response.status(500).json({ message: 'Unable to switch mode.' });
  }
});

app.patch('/auth/preferences', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  const body: unknown = request.body;
  const offeredServices =
    typeof body === 'object' &&
    body !== null &&
    'offeredServices' in body
      ? readDapServices(body.offeredServices)
      : null;

  if (!offeredServices) {
    response.status(400).json({
      message: 'Select at least one valid dapper service.',
    });
    return;
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    user.offeredServices = offeredServices;
    await user.save();
    updateLiveDapperServices(userId, offeredServices);

    response.status(200).json({ user: serializeUser(user) });
  } catch (error) {
    console.error('Unable to update dapper preferences:', error);
    response.status(500).json({ message: 'Unable to save dapper preferences.' });
  }
});

app.post('/dap-requests/:requestId/rating', async (request, response) => {
  const userId = authenticateRequest(request, response);

  if (!userId) {
    return;
  }

  const body: unknown = request.body;
  if (
    !isRecord(body) ||
    typeof body.rating !== 'number' ||
    !Number.isInteger(body.rating) ||
    body.rating < 1 ||
    body.rating > 5
  ) {
    response.status(400).json({ message: 'Rating must be a whole number from 1 to 5.' });
    return;
  }

  let comment: string | null = null;
  if ('comment' in body && body.comment !== null && body.comment !== undefined) {
    if (typeof body.comment !== 'string') {
      response.status(400).json({ message: 'Rating comment must be text.' });
      return;
    }
    const trimmedComment = body.comment.trim();
    if (trimmedComment.length > 240) {
      response.status(400).json({
        message: 'Rating comment must be 240 characters or fewer.',
      });
      return;
    }
    comment = trimmedComment.length > 0 ? trimmedComment : null;
  }

  let ratingClaimed = false;
  const ratedAt = new Date();
  try {
    const requestId = request.params.requestId;
    const ratingRecord = await DapRating.findOneAndUpdate(
      { requestId, userId, rating: null },
      { $set: { rating: body.rating, comment, ratedAt } },
      { new: true },
    );

    if (!ratingRecord) {
      const existingRecord = await DapRating.exists({ requestId, userId });
      response
        .status(existingRecord ? 409 : 404)
        .json({
          message: existingRecord
            ? 'This UberDap has already been rated.'
            : 'No delivered UberDap was found to rate.',
        });
      return;
    }
    ratingClaimed = true;

    if (ratingRecord.dapperId === userId) {
      await DapRating.updateOne(
        { requestId, userId, rating: body.rating },
        { $set: { rating: null, comment: null, ratedAt: null } },
      );
      ratingClaimed = false;
      response.status(403).json({ message: 'You cannot rate your own UberDap.' });
      return;
    }

    const dapperUser = await User.findByIdAndUpdate(
      ratingRecord.dapperId,
      {
        $inc: {
          crispinessRatingTotal: body.rating,
          crispinessRatingCount: 1,
        },
      },
      { new: true },
    ).select('crispinessRatingTotal crispinessRatingCount');

    if (!dapperUser) {
      await DapRating.updateOne(
        { requestId, userId, rating: body.rating },
        { $set: { rating: null, comment: null, ratedAt: null } },
      );
      ratingClaimed = false;
      response.status(404).json({ message: 'The dapper account no longer exists.' });
      return;
    }
    ratingClaimed = false;

    const averageRating = Number(
      (dapperUser.crispinessRatingTotal / dapperUser.crispinessRatingCount).toFixed(
        2,
      ),
    );
    const dapper = activeDappers.get(dapperUser.id);
    if (dapper) {
      dapper.crispinessRatingTotal = dapperUser.crispinessRatingTotal;
      dapper.crispinessRatingCount = dapperUser.crispinessRatingCount;
      sendWebSocketMessage(dapper.socket, {
        type: 'rating_received',
        requestId,
        rating: body.rating,
        comment,
        service: ratingRecord.service ?? null,
        crispinessRating: averageRating,
        crispinessRatingCount: dapperUser.crispinessRatingCount,
      });
    }

    response.status(200).json({
      crispinessRating: averageRating,
      crispinessRatingCount: dapperUser.crispinessRatingCount,
      rating: body.rating,
      comment,
    });
  } catch (error) {
    if (ratingClaimed) {
      try {
        await DapRating.updateOne(
          {
            requestId: request.params.requestId,
            userId,
            rating: body.rating,
          },
          { $set: { rating: null, comment: null, ratedAt: null } },
        );
      } catch (rollbackError) {
        console.error('Unable to release UberDap rating:', rollbackError);
      }
    }
    console.error('Unable to save UberDap rating:', error);
    response.status(500).json({ message: 'Unable to save the UberDap rating.' });
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
    stopOrderLocationStream(userId, 'Account deleted.');
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

async function handleRealtimeMessage(
  socket: WebSocket,
  message: Record<string, unknown>,
  session: SocketSession,
): Promise<void> {
  if (!session.userId) {
    if (session.isAuthenticating) {
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

    session.isAuthenticating = true;
    const user = await User.findById(tokenUserId).select(
      'activeMode username name offeredServices crispinessRatingTotal crispinessRatingCount',
    );

    if (!user) {
      socket.close(1008, 'User account not found.');
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    session.userId = user.id;
    session.username = user.username;
    session.activeMode = user.activeMode;
    session.isAuthenticating = false;

    if (user.activeMode === 'dapper') {
      const offeredServices = (user.offeredServices ?? []).filter(isDapService);
      if (offeredServices.length === 0) {
        socket.close(1008, 'Choose at least one dapper service first.');
        return;
      }

      const previousDapper = getOrCreateDapper(
        user.id,
        user.username,
        user.name ?? null,
        offeredServices,
        user.crispinessRatingTotal ?? 0,
        user.crispinessRatingCount ?? 0,
      );
      const previousSocket = previousDapper.socket;
      if (previousSocket && previousSocket !== socket) {
        handleDapperSocketDisconnect(user.id, previousSocket);
      }

      const dapper = getOrCreateDapper(
        user.id,
        user.username,
        user.name ?? null,
        offeredServices,
        user.crispinessRatingTotal ?? 0,
        user.crispinessRatingCount ?? 0,
      );
      dapper.socket = socket;
      dapper.location = null;
      dapper.lastLocationAt = 0;
      if (previousSocket && previousSocket !== socket) {
        previousSocket.close(4001, 'Replaced by a newer connection.');
      }

      sendWebSocketMessage(socket, {
        type: 'authenticated',
        activeMode: user.activeMode,
      });

      if (dapper.activeRequestId) {
        sendActiveRequestToDapper(dapper);
      } else if (dapper.pendingOfferId) {
        const request = dapRequests.get(dapper.pendingOfferId);
        if (request) {
          sendDapperOffer(request, dapper);
        }
      }

      return;
    }

    const previousSocket = activeUserSockets.get(user.id);
    if (
      previousSocket &&
      previousSocket !== socket &&
      message.restoreRequestState !== true
    ) {
      const activeRequestId = activeRequestIdsByUser.get(user.id);
      const activeRequest = activeRequestId
        ? dapRequests.get(activeRequestId)
        : undefined;
      if (activeRequest?.status === 'pending') {
        cancelDapRequest(activeRequest, 'User disconnected.', false);
      }
    }
    activeUserSockets.set(user.id, socket);
    previousSocket?.close(4001, 'Replaced by a newer connection.');
    sendWebSocketMessage(socket, {
      type: 'authenticated',
      activeMode: user.activeMode,
    });

    if (message.restoreRequestState === true) {
      const activeRequestId = activeRequestIdsByUser.get(user.id);
      const activeRequest = activeRequestId
        ? dapRequests.get(activeRequestId)
        : undefined;
      if (activeRequest) {
        if (activeRequest.disconnectTimeout) {
          clearTimeout(activeRequest.disconnectTimeout);
          activeRequest.disconnectTimeout = null;
        }
        activeRequest.userSocket = socket;
        sendUserRequestState(activeRequest);
      } else {
        sendWebSocketMessage(socket, {
          type: 'request_state',
          status: 'idle',
        });
      }
    }
    return;
  }

  if (message.type === 'ping') {
    if (session.activeMode === 'dapper') {
      const dapper = activeDappers.get(session.userId);
      if (dapper && dapper.socket === socket && dapper.location !== null) {
        dapper.lastLocationAt = Date.now();
      }
    }
    sendWebSocketMessage(socket, { type: 'pong' });
    return;
  }

  if (session.activeMode === 'dapper') {
  await handleDapperMessage(socket, session.userId, message);
    return;
  }

  if (session.activeMode === 'order') {
    if (!session.username) {
      socket.close(1008, 'Authenticated username is missing.');
      return;
    }

    handleOrderMessage(socket, session.userId, session.username, message);
    return;
  }

  socket.close(1008, 'Invalid account mode.');
}

async function handleDapperMessage(
  socket: WebSocket,
  userId: string,
  message: Record<string, unknown>,
): Promise<void> {
  const dapper = activeDappers.get(userId);

  if (!dapper || dapper.socket !== socket) {
    socket.close(1008, 'Dapper connection is not active.');
    return;
  }

  if (message.type === 'location') {
    const location = readCoordinates(message);

    if (!location) {
      socket.close(1008, 'Invalid location message.');
      return;
    }

    dapper.location = location;
    dapper.lastLocationAt = Date.now();
    const activeRequest = dapper.activeRequestId
      ? dapRequests.get(dapper.activeRequestId)
      : undefined;
    if (
      activeRequest?.status === 'matched' &&
      activeRequest.dapperId === userId
    ) {
      sendWebSocketMessage(activeRequest.userSocket, {
        type: 'dapper_location',
        requestId: activeRequest.id,
        location,
      });
    }
    dispatchPendingRequests();
    return;
  }

  if (message.type === 'decline') {
    declineDapperOffer(userId, dapper, message.requestId);
    return;
  }

  if (message.type === 'accept') {
    acceptDapperOffer(userId, dapper, message.requestId);
    return;
  }

  if (message.type === 'delivered') {
    await deliverDap(userId, dapper, message.requestId);
    return;
  }

  if (message.type === 'offline') {
    socket.close(1000, 'Dapper went offline.');
    return;
  }

  socket.close(1008, 'Unsupported dapper message.');
}

function handleOrderMessage(
  socket: WebSocket,
  userId: string,
  username: string,
  message: Record<string, unknown>,
): void {
  if (activeUserSockets.get(userId) !== socket) {
    socket.close(1008, 'Order connection is not active.');
    return;
  }

  if (message.type === 'request') {
    createDapRequest(userId, username, socket, message);
    return;
  }

  const requestId = activeRequestIdsByUser.get(userId);
  const request = requestId ? dapRequests.get(requestId) : undefined;

  if (message.type === 'location') {
    const location = readCoordinates(message);

    if (!location) {
      socket.close(1008, 'Invalid location message.');
      return;
    }

    if (request?.status === 'matched') {
      return;
    }

    if (!request || request.status !== 'pending') {
      socket.close(1008, 'No pending UberDap request accepts location.');
      return;
    }

    request.location = location;
    dispatchRequest(request);
    return;
  }

  if (message.type === 'cancel_request') {
    if (request?.status === 'pending') {
      cancelDapRequest(request, 'Request cancelled.', true);
    }
    return;
  }

  socket.close(1008, 'Unsupported order message.');
}

function createDapRequest(
  userId: string,
  username: string,
  socket: WebSocket,
  message: Record<string, unknown>,
): void {
  const service = message.service;
  const location = readCoordinates(message);

  if (!isDapService(service) || !location) {
    sendWebSocketMessage(socket, {
      type: 'request_error',
      message: 'A valid UberDap option and location are required.',
    });
    return;
  }

  const activeRequestId = activeRequestIdsByUser.get(userId);
  const existingRequest = activeRequestId
    ? dapRequests.get(activeRequestId)
    : undefined;
  if (existingRequest) {
    sendWebSocketMessage(socket, {
      type: 'request_error',
      message: 'You already have an active UberDap request.',
    });
    return;
  }

  if (activeUserSockets.get(userId) !== socket) {
    return;
  }

  const createdAt = Date.now();
  const requestId = randomUUID();
  const request: DapRequest = {
    id: requestId,
    userId,
    username,
    userSocket: socket,
    service,
    location,
    createdAt,
    deadlineAt: createdAt + 10 * 60 * 1000,
    status: 'pending',
    declinedDapperIds: new Set(),
    offeredDapperId: null,
    dapperId: null,
    timeout: null,
    offerTimeout: null,
    disconnectTimeout: null,
  };

  request.timeout = setTimeout(
    () => expireDapRequest(requestId),
    request.deadlineAt - createdAt,
  );
  dapRequests.set(requestId, request);
  activeRequestIdsByUser.set(userId, requestId);

  if (
    !sendWebSocketMessage(socket, {
      type: 'request_started',
      requestId,
      service,
      deadlineAt: request.deadlineAt,
    })
  ) {
    cancelDapRequest(request, 'User disconnected.', false);
    return;
  }

  dispatchRequest(request);
}

function readCoordinates(
  value: Record<string, unknown>,
): Coordinates | null {
  const { latitude, longitude } = value;

  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function isDapService(value: unknown): value is DapService {
  return (
    typeof value === 'string' &&
    DAP_SERVICES.some((service) => service === value)
  );
}

function dispatchPendingRequests(): void {
  const pendingRequests = [...dapRequests.values()]
    .filter((request) => request.status === 'pending')
    .sort((left, right) => left.createdAt - right.createdAt);

  for (const request of pendingRequests) {
    dispatchRequest(request);
  }
}

function dispatchRequest(request: DapRequest): void {
  if (
    request.status !== 'pending' ||
    !dapRequests.has(request.id)
  ) {
    return;
  }

  if (request.offeredDapperId !== null) {
    const offeredDapper = activeDappers.get(request.offeredDapperId);
    if (
      offeredDapper?.socket?.readyState === WebSocket.OPEN &&
      offeredDapper.location &&
      offeredDapper.offeredServices.includes(request.service) &&
      offeredDapper.activeRequestId === null &&
      offeredDapper.pendingOfferId === request.id &&
      Date.now() - offeredDapper.lastLocationAt <=
        DAPPER_LOCATION_STALE_AFTER_MS &&
      distanceInKm(request.location, offeredDapper.location) <= 75
    ) {
      return;
    }

    request.declinedDapperIds.add(request.offeredDapperId);
    clearDapperOffer(request, true);
  }

  if (Date.now() >= request.deadlineAt) {
    expireDapRequest(request.id);
    return;
  }

  const candidates = [...activeDappers.entries()]
    .filter(([dapperId, dapper]) => {
      return (
        dapper.socket?.readyState === WebSocket.OPEN &&
        dapper.location !== null &&
        Date.now() - dapper.lastLocationAt <= DAPPER_LOCATION_STALE_AFTER_MS &&
        dapper.activeRequestId === null &&
        dapper.pendingOfferId === null &&
        dapper.offeredServices.includes(request.service) &&
        !request.declinedDapperIds.has(dapperId)
      );
    })
    .map(([dapperId, dapper]) => ({
      dapperId,
      dapper,
      distanceKm: distanceInKm(request.location, dapper.location!),
    }))
    .filter((candidate) => candidate.distanceKm <= 75)
    .sort((left, right) => left.distanceKm - right.distanceKm);

  const nearest = candidates[0];

  if (!nearest) {
    return;
  }

  request.offeredDapperId = nearest.dapperId;
  nearest.dapper.pendingOfferId = request.id;

  if (!sendDapperOffer(request, nearest.dapper)) {
    handleDapperSocketDisconnect(nearest.dapperId, nearest.dapper.socket!);
    return;
  }

  request.offerTimeout = setTimeout(() => {
    if (request.offeredDapperId !== nearest.dapperId) {
      return;
    }

    request.declinedDapperIds.add(nearest.dapperId);
    clearDapperOffer(request, true);
    dispatchRequest(request);
    dispatchPendingRequests();
  }, 30 * 1000);
}

function sendDapperOffer(request: DapRequest, dapper: ActiveDapper): boolean {
  if (!dapper.location) {
    return false;
  }

  return sendWebSocketMessage(dapper.socket, {
    type: 'offer',
    requestId: request.id,
    service: request.service,
    userName: request.username,
    location: request.location,
    distanceKm: distanceInKm(request.location, dapper.location),
    deadlineAt: request.deadlineAt,
  });
}

function sendActiveRequestToDapper(dapper: ActiveDapper): void {
  if (!dapper.activeRequestId) {
    return;
  }

  const request = dapRequests.get(dapper.activeRequestId);
  if (!request || request.status !== 'matched') {
    dapper.activeRequestId = null;
    return;
  }

  sendWebSocketMessage(dapper.socket, {
    type: 'active_request',
    requestId: request.id,
    service: request.service,
    userName: request.username,
    location: request.location,
  });
}

function sendUserRequestState(request: DapRequest): void {
  if (request.status === 'pending') {
    sendWebSocketMessage(request.userSocket, {
      type: 'request_state',
      status: 'searching',
      requestId: request.id,
      service: request.service,
      deadlineAt: request.deadlineAt,
    });
    return;
  }

  if (request.dapperId) {
    const dapper = activeDappers.get(request.dapperId);
    sendWebSocketMessage(request.userSocket, {
      type: 'request_state',
      status: 'matched',
      requestId: request.id,
      service: request.service,
      dapper: {
        id: request.dapperId,
        username: dapper?.username ?? 'Your dapper',
        name: dapper?.name ?? null,
        crispinessRating: dapper ? getCrispinessRating(dapper) : 2.5,
        crispinessRatingCount: dapper?.crispinessRatingCount ?? 0,
        location: dapper?.location ?? null,
      },
    });
  }
}

function acceptDapperOffer(
  dapperId: string,
  dapper: ActiveDapper,
  requestId: unknown,
): void {
  if (typeof requestId !== 'string' || dapper.pendingOfferId !== requestId) {
    sendWebSocketMessage(dapper.socket, {
      type: 'offer_cancelled',
      requestId,
    });
    return;
  }

  const request = dapRequests.get(requestId);
  if (request?.status === 'pending' && Date.now() >= request.deadlineAt) {
    expireDapRequest(request.id);
    return;
  }

  if (
    !request ||
    request.status !== 'pending' ||
    request.offeredDapperId !== dapperId ||
    dapper.activeRequestId !== null ||
    !dapper.location ||
    !dapper.offeredServices.includes(request.service) ||
    Date.now() - dapper.lastLocationAt > DAPPER_LOCATION_STALE_AFTER_MS ||
    distanceInKm(request.location, dapper.location) > 75
  ) {
    if (request?.status === 'pending' && request.offeredDapperId === dapperId) {
      request.declinedDapperIds.add(dapperId);
      clearDapperOffer(request, true);
      dispatchRequest(request);
      dispatchPendingRequests();
    } else {
      sendWebSocketMessage(dapper.socket, {
        type: 'offer_cancelled',
        requestId,
      });
    }
    return;
  }

  clearDapperOffer(request, false);
  request.status = 'matched';
  request.dapperId = dapperId;
  if (request.timeout) {
    clearTimeout(request.timeout);
    request.timeout = null;
  }
  dapper.activeRequestId = request.id;

  sendWebSocketMessage(request.userSocket, {
    type: 'request_matched',
    requestId: request.id,
    dapper: {
      id: dapperId,
      username: dapper.username,
      name: dapper.name,
      crispinessRating: getCrispinessRating(dapper),
      crispinessRatingCount: dapper.crispinessRatingCount,
      location: dapper.location,
    },
  });
  sendActiveRequestToDapper(dapper);
}

function declineDapperOffer(
  dapperId: string,
  dapper: ActiveDapper,
  requestId: unknown,
): void {
  if (typeof requestId !== 'string' || dapper.pendingOfferId !== requestId) {
    return;
  }

  const request = dapRequests.get(requestId);
  if (
    !request ||
    request.status !== 'pending' ||
    request.offeredDapperId !== dapperId
  ) {
    clearDapperOffer(request, false);
    return;
  }

  request.declinedDapperIds.add(dapperId);
  clearDapperOffer(request, false);
  sendWebSocketMessage(dapper.socket, {
    type: 'offer_declined',
    requestId,
  });
  dispatchRequest(request);
  dispatchPendingRequests();
}

async function deliverDap(
  dapperId: string,
  dapper: ActiveDapper,
  requestId: unknown,
): Promise<void> {
  if (
    typeof requestId !== 'string' ||
    dapper.activeRequestId !== requestId
  ) {
    return;
  }

  const request = dapRequests.get(requestId);
  if (
    !request ||
    request.status !== 'matched' ||
    request.dapperId !== dapperId
  ) {
    dapper.activeRequestId = null;
    return;
  }

  await DapRating.create({
    requestId,
    userId: request.userId,
    dapperId,
    service: request.service,
    raterUsername: request.username,
  });

  sendWebSocketMessage(request.userSocket, {
    type: 'dap_delivered',
    requestId,
  });
  sendWebSocketMessage(dapper.socket, {
    type: 'dap_delivered',
    requestId,
  });
  dapper.activeRequestId = null;
  removeDapRequest(request);
  dispatchPendingRequests();
}

function expireDapRequest(requestId: string): void {
  const request = dapRequests.get(requestId);
  if (!request || request.status !== 'pending') {
    return;
  }

  clearDapperOffer(request, true);
  sendWebSocketMessage(request.userSocket, {
    type: 'request_failed',
    reason: 'timeout',
  });
  removeDapRequest(request);
  dispatchPendingRequests();
}

function cancelDapRequest(
  request: DapRequest,
  reason: string,
  notifyUser: boolean,
): void {
  if (request.status !== 'pending') {
    return;
  }

  clearDapperOffer(request, true);
  if (notifyUser) {
    sendWebSocketMessage(request.userSocket, {
      type: 'request_cancelled',
      reason,
    });
  }
  removeDapRequest(request);
  dispatchPendingRequests();
}

function clearDapperOffer(request: DapRequest | undefined, notify: boolean): void {
  if (!request) {
    return;
  }

  if (request.offerTimeout) {
    clearTimeout(request.offerTimeout);
    request.offerTimeout = null;
  }

  const dapperId = request.offeredDapperId;
  request.offeredDapperId = null;
  if (!dapperId) {
    return;
  }

  const dapper = activeDappers.get(dapperId);
  if (dapper?.pendingOfferId === request.id) {
    dapper.pendingOfferId = null;
    if (notify) {
      sendWebSocketMessage(dapper.socket, {
        type: 'offer_cancelled',
        requestId: request.id,
      });
    }
  }
}

function removeDapRequest(request: DapRequest): void {
  if (request.timeout) {
    clearTimeout(request.timeout);
  }
  if (request.offerTimeout) {
    clearTimeout(request.offerTimeout);
  }
  if (request.disconnectTimeout) {
    clearTimeout(request.disconnectTimeout);
  }
  dapRequests.delete(request.id);
  if (activeRequestIdsByUser.get(request.userId) === request.id) {
    activeRequestIdsByUser.delete(request.userId);
  }
}

function handleDapperSocketDisconnect(
  userId: string,
  socket: WebSocket,
): void {
  const dapper = activeDappers.get(userId);
  if (!dapper || dapper.socket !== socket) {
    return;
  }

  dapper.socket = null;
  dapper.location = null;
  dapper.lastLocationAt = 0;

  if (dapper.pendingOfferId) {
    const request = dapRequests.get(dapper.pendingOfferId);
    if (
      request?.status === 'pending' &&
      request.offeredDapperId === userId
    ) {
      request.declinedDapperIds.add(userId);
      clearDapperOffer(request, false);
      dispatchRequest(request);
    } else {
      dapper.pendingOfferId = null;
    }
  }

  if (!dapper.activeRequestId && !dapper.pendingOfferId) {
    activeDappers.delete(userId);
  }
}

function handleOrderSocketDisconnect(userId: string, socket: WebSocket): void {
  if (activeUserSockets.get(userId) !== socket) {
    return;
  }

  activeUserSockets.delete(userId);
  const requestId = activeRequestIdsByUser.get(userId);
  const request = requestId ? dapRequests.get(requestId) : undefined;
  if (request?.status === 'pending') {
    request.userSocket = null;
    if (request.disconnectTimeout) {
      clearTimeout(request.disconnectTimeout);
    }
    request.disconnectTimeout = setTimeout(() => {
      request.disconnectTimeout = null;
      if (request.status === 'pending' && request.userSocket === null) {
        cancelDapRequest(request, 'User disconnected.', false);
      }
    }, ORDER_DISCONNECT_GRACE_MS);
  } else if (request) {
    request.userSocket = null;
  }
}

function stopDapperLocationStream(userId: string, reason: string): void {
  const dapper = activeDappers.get(userId);
  if (!dapper) {
    return;
  }

  const socket = dapper.socket;
  dapper.socket = null;
  dapper.location = null;
  dapper.lastLocationAt = 0;

  if (dapper.pendingOfferId) {
    const request = dapRequests.get(dapper.pendingOfferId);
    if (request?.status === 'pending') {
      request.declinedDapperIds.add(userId);
      clearDapperOffer(request, true);
      dispatchRequest(request);
    }
  }

  if (dapper.activeRequestId) {
    const request = dapRequests.get(dapper.activeRequestId);
    if (request?.status === 'matched') {
      sendWebSocketMessage(request.userSocket, {
        type: 'request_failed',
        reason: 'dapper_unavailable',
      });
      removeDapRequest(request);
    }
    dapper.activeRequestId = null;
  }

  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close(1008, reason);
  }
  activeDappers.delete(userId);
  dispatchPendingRequests();
}

function stopOrderLocationStream(userId: string, reason: string): void {
  const socket = activeUserSockets.get(userId);
  if (!socket) {
    return;
  }

  activeUserSockets.delete(userId);
  const requestId = activeRequestIdsByUser.get(userId);
  const request = requestId ? dapRequests.get(requestId) : undefined;

  if (request?.status === 'pending') {
    cancelDapRequest(request, reason, false);
  } else if (request?.status === 'matched') {
    const dapper = request.dapperId
      ? activeDappers.get(request.dapperId)
      : undefined;
    if (dapper?.activeRequestId === request.id) {
      dapper.activeRequestId = null;
      sendWebSocketMessage(dapper.socket, {
        type: 'request_cancelled',
        requestId: request.id,
      });
    }
    removeDapRequest(request);
  }

  if (socket.readyState < WebSocket.CLOSING) {
    socket.close(1008, reason);
  }
}

function getOrCreateDapper(
  userId: string,
  username: string,
  name: string | null,
  offeredServices: DapService[],
  crispinessRatingTotal: number,
  crispinessRatingCount: number,
): ActiveDapper {
  let dapper = activeDappers.get(userId);
  if (!dapper) {
    dapper = {
      username,
      name,
      offeredServices,
      crispinessRatingTotal,
      crispinessRatingCount,
      socket: null,
      location: null,
      lastLocationAt: 0,
      pendingOfferId: null,
      activeRequestId: null,
    };
    activeDappers.set(userId, dapper);
  } else {
    dapper.username = username;
    dapper.name = name;
    dapper.offeredServices = offeredServices;
    dapper.crispinessRatingTotal = crispinessRatingTotal;
    dapper.crispinessRatingCount = crispinessRatingCount;
  }

  return dapper;
}

function getCrispinessRating(dapper: ActiveDapper): number {
  return dapper.crispinessRatingCount === 0
    ? 2.5
    : dapper.crispinessRatingTotal / dapper.crispinessRatingCount;
}

function updateLiveDapperServices(
  userId: string,
  offeredServices: DapService[],
): void {
  const dapper = activeDappers.get(userId);
  if (!dapper) {
    return;
  }

  dapper.offeredServices = offeredServices;
  if (!dapper.pendingOfferId) {
    dispatchPendingRequests();
    return;
  }

  const request = dapRequests.get(dapper.pendingOfferId);
  if (
    request?.status === 'pending' &&
    !offeredServices.includes(request.service)
  ) {
    request.declinedDapperIds.add(userId);
    clearDapperOffer(request, true);
    dispatchRequest(request);
  }

  dispatchPendingRequests();
}

function sendWebSocketMessage(
  socket: WebSocket | null,
  message: unknown,
): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function distanceInKm(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDifference = radians(to.latitude - from.latitude);
  const longitudeDifference = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
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
  name: string | null;
  authProvider: AuthProvider;
  steamUsername: string | null;
  steamAvatar: string | null;
  stravaUsername: string | null;
  stravaAvatar: string | null;
  activeMode: AppMode;
  offeredServices: DapService[];
  crispinessRating: number | null;
  crispinessRatingCount: number;
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
  name?: string | null;
  authProvider?: AuthProvider;
  steamUsername?: string | null;
  steamAvatar?: string | null;
  stravaUsername?: string | null;
  stravaAvatar?: string | null;
  activeMode?: AppMode;
  offeredServices?: DapService[];
  crispinessRatingTotal?: number;
  crispinessRatingCount?: number;
  hasCompletedOnboarding?: boolean;
}): SerializedUser {
  const ratingTotal = user.crispinessRatingTotal ?? 0;
  const ratingCount = user.crispinessRatingCount ?? 0;

  return {
    id: user.id,
    username: user.username,
    name: user.name ?? null,
    authProvider:
      user.authProvider === 'strava'
        ? 'strava'
        : user.authProvider === 'steam'
          ? 'steam'
          : 'local',
    steamUsername: user.steamUsername ?? null,
    steamAvatar: user.steamAvatar ?? null,
    stravaUsername: user.stravaUsername ?? null,
    stravaAvatar: user.stravaAvatar ?? null,
    activeMode: user.activeMode === 'dapper' ? 'dapper' : 'order',
    offeredServices: (user.offeredServices ?? []).filter(isDapService),
    crispinessRating:
      ratingCount > 0 ? Number((ratingTotal / ratingCount).toFixed(2)) : null,
    crispinessRatingCount: ratingCount,
    hasCompletedOnboarding: Boolean(user.hasCompletedOnboarding),
  };
}

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;

function deriveScryptKey(password: string, saltHex: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, saltHex, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const saltHex = randomBytes(16).toString('hex');
  const derivedKey = await deriveScryptKey(password, saltHex);
  return `${SCRYPT_PREFIX}$${saltHex}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (storedPassword.startsWith(`${SCRYPT_PREFIX}$`)) {
    const parts = storedPassword.split('$');
    if (parts.length !== 3) {
      return { valid: false, needsRehash: false };
    }
    const [, saltHex, storedHex] = parts;
    if (!saltHex || !storedHex || storedHex.length % 2 !== 0) {
      return { valid: false, needsRehash: false };
    }
    const storedBuffer = Buffer.from(storedHex, 'hex');
    const derivedKey = await deriveScryptKey(password, saltHex);
    if (storedBuffer.length !== derivedKey.length) {
      return { valid: false, needsRehash: false };
    }
    return {
      valid: timingSafeEqual(storedBuffer, derivedKey),
      needsRehash: false,
    };
  }

  // Support migrating legacy plaintext passwords stored prior to scrypt hashing.
  const providedBuffer = Buffer.from(password, 'utf8');
  const legacyBuffer = Buffer.from(storedPassword, 'utf8');
  const maxLength = Math.max(providedBuffer.length, legacyBuffer.length, 1);
  const paddedProvided = Buffer.alloc(maxLength);
  const paddedLegacy = Buffer.alloc(maxLength);
  providedBuffer.copy(paddedProvided);
  legacyBuffer.copy(paddedLegacy);
  const valid =
    providedBuffer.length === legacyBuffer.length &&
    timingSafeEqual(paddedProvided, paddedLegacy);
  return { valid, needsRehash: valid };
}

function isAppMode(value: unknown): value is AppMode {
  return value === 'order' || value === 'dapper';
}

function readDapServices(value: unknown): DapService[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const services = value.filter(isDapService);
  return services.length === value.length ? [...new Set(services)] : null;
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

function resolveSteamRedirectUri(
  request: Request,
  requestedRedirectUri?: unknown,
): string {
  const configured = process.env.STEAM_OPENID_RETURN_URL?.trim();
  let canonicalUrl: URL | null = null;

  if (configured) {
    canonicalUrl = isValidHttpUrl(configured);
    if (!canonicalUrl) {
      throw new SteamAuthConfigError(
        'STEAM_OPENID_RETURN_URL must be a valid http(s) URL.',
      );
    }
  } else {
    const publicBackendUrl = process.env.PUBLIC_BACKEND_URL?.trim();
    if (publicBackendUrl) {
      const parsedPublic = isValidHttpUrl(publicBackendUrl);
      if (!parsedPublic) {
        throw new SteamAuthConfigError(
          'PUBLIC_BACKEND_URL must be a valid http(s) URL.',
        );
      }
      canonicalUrl = new URL(
        `${parsedPublic.toString().replace(/\/+$/, '')}/auth/steam/callback`,
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

      canonicalUrl = isValidHttpUrl(`${protocol}://${host}/auth/steam/callback`);
      if (!canonicalUrl) {
        throw new SteamAuthFlowError(
          'Unable to resolve a valid Steam OpenID callback URL.',
          400,
        );
      }
    }
  }

  if (requestedRedirectUri !== undefined && requestedRedirectUri !== null) {
    if (typeof requestedRedirectUri !== 'string') {
      throw new SteamAuthFlowError(
        'Steam OpenID redirectUri must be a valid URL string.',
        400,
      );
    }

    const trimmed = requestedRedirectUri.trim();
    if (trimmed.length > 0) {
      const parsedRequested = isValidHttpUrl(trimmed);
      if (!parsedRequested) {
        throw new SteamAuthFlowError(
          'Steam OpenID redirectUri must be a valid http(s) URL.',
          400,
        );
      }

      if (
        parsedRequested.origin !== canonicalUrl.origin ||
        parsedRequested.pathname !== canonicalUrl.pathname ||
        parsedRequested.search !== canonicalUrl.search ||
        parsedRequested.hash !== canonicalUrl.hash
      ) {
        throw new SteamAuthFlowError(
          'Steam OpenID redirectUri does not match the configured callback URL.',
          400,
        );
      }

      return parsedRequested.toString();
    }
  }

  return canonicalUrl.toString();
}

function resolveStravaRedirectUri(request: Request): string {
  const configured = process.env.STRAVA_REDIRECT_URI?.trim();
  if (configured) {
    const parsed = isValidHttpUrl(configured);
    if (!parsed) {
      throw new StravaAuthConfigError(
        'STRAVA_REDIRECT_URI must be a valid http(s) URL.',
      );
    }
    if (
      parsed.pathname !== '/auth/strava/callback' ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw new StravaAuthConfigError(
        'STRAVA_REDIRECT_URI must use the /auth/strava/callback path without query or fragment.',
      );
    }
    return parsed.toString();
  }

  const publicBackendUrl = process.env.PUBLIC_BACKEND_URL?.trim();
  if (publicBackendUrl) {
    const parsedPublic = isValidHttpUrl(publicBackendUrl);
    if (!parsedPublic) {
      throw new StravaAuthConfigError(
        'PUBLIC_BACKEND_URL must be a valid http(s) URL.',
      );
    }
    return `${parsedPublic.toString().replace(/\/+$/, '')}/auth/strava/callback`;
  }

  const forwardedProto = request
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  const protocol = forwardedProto || request.protocol || 'http';
  const host =
    request.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.get('host') ||
    `localhost:${port}`;
  const callbackUrl = isValidHttpUrl(
    `${protocol}://${host}/auth/strava/callback`,
  );
  if (!callbackUrl) {
    throw new StravaAuthFlowError(
      'Unable to resolve a valid Strava callback URL.',
      400,
    );
  }
  return callbackUrl.toString();
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

function buildNativeSteamDeepLink(
  returnTo: string | null,
  params: Record<string, string>,
): string {
  const baseUrl =
    returnTo && !isHttpUrl(returnTo) ? returnTo : 'uberdaps://auth/steam';
  const target = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

function sendSteamCallbackError(
  response: Response,
  returnTo: string | null,
  message: string,
): void {
  if (returnTo && isHttpUrl(returnTo)) {
    const target = new URL(returnTo);
    target.searchParams.set('steam_error', message);
    response.redirect(302, target.toString());
    return;
  }

  const deepLinkTarget = buildNativeSteamDeepLink(returnTo, {
    steam_error: message,
  });

  response
    .status(400)
    .type('html')
    .send(
      renderSteamCallbackHtml(
        'Steam Sign-In Failed',
        message,
        deepLinkTarget,
      ),
    );
}

function buildNativeStravaDeepLink(
    returnTo: string | null,
    params: Record<string, string>,
): string {
    const baseUrl =
      returnTo && !isHttpUrl(returnTo) ? returnTo : 'uberdaps://auth/strava';
    const target = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value);
    }
    return target.toString();
}

function sendStravaCallbackError(
    response: Response,
    returnTo: string | null,
    message: string,
): void {
    if (returnTo && isHttpUrl(returnTo)) {
      const target = new URL(returnTo);
      target.searchParams.set('strava_error', message);
      response.redirect(302, target.toString());
      return;
    }

    const deepLinkTarget = buildNativeStravaDeepLink(returnTo, {
      strava_error: message,
    });
    response
      .status(400)
      .type('html')
      .send(renderSteamCallbackHtml('Strava Sign-In Failed', message, deepLinkTarget));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSteamCallbackHtml(
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

function sanitizeBaseUsername(
  raw: string,
  fallbackUsername = 'steam_player',
): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  if (cleaned.length >= 2) {
    return cleaned;
  }

  return fallbackUsername;
}

async function findOrCreateSteamUser(profile: SteamUserProfile) {
  let user = await User.findOne({ steamId: profile.steamId });

  if (user) {
    let dirty = false;
    if (user.authProvider !== 'steam') {
      user.authProvider = 'steam';
      dirty = true;
    }
    if (user.steamUsername !== profile.steamUsername) {
      user.steamUsername = profile.steamUsername;
      dirty = true;
    }
    if (profile.steamAvatar && user.steamAvatar !== profile.steamAvatar) {
      user.steamAvatar = profile.steamAvatar;
      dirty = true;
    }
    if (dirty) {
      await user.save();
    }
    return user;
  }

  const baseUsername = sanitizeBaseUsername(profile.steamUsername);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix =
      attempt === 0 ? '' : attempt === 1 ? '_steam' : `_steam_${attempt}`;
    const maxBaseLength = 40 - suffix.length;
    const candidate = `${baseUsername.slice(0, maxBaseLength)}${suffix}`;

    try {
      return await User.create({
        username: candidate,
        authProvider: 'steam',
        steamId: profile.steamId,
        steamUsername: profile.steamUsername,
        steamAvatar: profile.steamAvatar,
        activeMode: 'order',
        hasCompletedOnboarding: false,
      });
    } catch (error) {
      if (isDuplicateUsernameError(error)) {
        const existingBySteamId = await User.findOne({
          steamId: profile.steamId,
        });
        if (existingBySteamId) {
          return existingBySteamId;
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
    authProvider: 'steam',
    steamId: profile.steamId,
    steamUsername: profile.steamUsername,
    steamAvatar: profile.steamAvatar,
    activeMode: 'order',
    hasCompletedOnboarding: false,
  });
}

async function findOrCreateStravaUser(profile: StravaUserProfile) {
  let user = await User.findOne({ stravaId: profile.stravaId });
  if (user) {
    let dirty = false;
    if (user.authProvider !== 'strava') {
      user.authProvider = 'strava';
      dirty = true;
    }
    if (user.stravaUsername !== profile.stravaUsername) {
      user.stravaUsername = profile.stravaUsername;
      dirty = true;
    }
    if (profile.stravaAvatar && user.stravaAvatar !== profile.stravaAvatar) {
      user.stravaAvatar = profile.stravaAvatar;
      dirty = true;
    }
    if (!user.name && profile.name) {
      user.name = profile.name;
      dirty = true;
    }
    if (dirty) {
      await user.save();
    }
    return user;
  }

  const baseUsername = sanitizeBaseUsername(
    profile.stravaUsername,
    'strava_athlete',
  );
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix =
      attempt === 0 ? '' : attempt === 1 ? '_strava' : `_strava_${attempt}`;
    const maxBaseLength = 40 - suffix.length;
    const candidate = `${baseUsername.slice(0, maxBaseLength)}${suffix}`;
    try {
      return await User.create({
        username: candidate,
        name: profile.name,
        authProvider: 'strava',
        stravaId: profile.stravaId,
        stravaUsername: profile.stravaUsername,
        stravaAvatar: profile.stravaAvatar,
        activeMode: 'order',
        hasCompletedOnboarding: false,
      });
    } catch (error) {
      if (isDuplicateUsernameError(error)) {
        const existingByStravaId = await User.findOne({
          stravaId: profile.stravaId,
        });
        if (existingByStravaId) {
          return existingByStravaId;
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
    name: profile.name,
    authProvider: 'strava',
    stravaId: profile.stravaId,
    stravaUsername: profile.stravaUsername,
    stravaAvatar: profile.stravaAvatar,
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
