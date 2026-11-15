import 'dotenv/config';

import { randomUUID } from 'node:crypto';
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
const DAPPER_LOCATION_STALE_AFTER_MS = 15_000;

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
  const session: SocketSession = {
    userId: null,
    username: null,
    activeMode: null,
    isAuthenticating: false,
  };

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

  let ratingClaimed = false;
  try {
    const requestId = request.params.requestId;
    const ratingRecord = await DapRating.findOneAndUpdate(
      { requestId, userId, rating: null },
      { $set: { rating: body.rating } },
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
        { $set: { rating: null } },
      );
      ratingClaimed = false;
      response.status(404).json({ message: 'The dapper account no longer exists.' });
      return;
    }
    ratingClaimed = false;

    const dapper = activeDappers.get(dapperUser.id);
    if (dapper) {
      dapper.crispinessRatingTotal = dapperUser.crispinessRatingTotal;
      dapper.crispinessRatingCount = dapperUser.crispinessRatingCount;
    }

    response.status(200).json({
      crispinessRating:
        dapperUser.crispinessRatingTotal / dapperUser.crispinessRatingCount,
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
          { $set: { rating: null } },
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
      'activeMode username offeredServices crispinessRatingTotal crispinessRatingCount',
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
      const offeredServices = user.offeredServices ?? [];
      if (offeredServices.length === 0) {
        socket.close(1008, 'Choose at least one dapper service first.');
        return;
      }

      const previousDapper = getOrCreateDapper(
        user.id,
        user.username,
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
        crispinessRating: dapper ? getCrispinessRating(dapper) : 2.5,
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
      crispinessRating: getCrispinessRating(dapper),
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
  if (request) {
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
  offeredServices: DapService[],
  crispinessRatingTotal: number,
  crispinessRatingCount: number,
): ActiveDapper {
  let dapper = activeDappers.get(userId);
  if (!dapper) {
    dapper = {
      username,
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
  authProvider: AuthProvider;
  chessUsername: string | null;
  chessAvatar: string | null;
  activeMode: AppMode;
  offeredServices: DapService[];
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
  offeredServices?: DapService[];
  hasCompletedOnboarding?: boolean;
}): SerializedUser {
  return {
    id: user.id,
    username: user.username,
    authProvider: user.authProvider === 'chess' ? 'chess' : 'local',
    chessUsername: user.chessUsername ?? null,
    chessAvatar: user.chessAvatar ?? null,
    activeMode: user.activeMode === 'dapper' ? 'dapper' : 'order',
    offeredServices: user.offeredServices ?? [],
    hasCompletedOnboarding: Boolean(user.hasCompletedOnboarding),
  };
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
