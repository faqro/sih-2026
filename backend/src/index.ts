import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';

import {
  DAP_SERVICES,
  User,
  type AppMode,
  type DapService,
} from './models/User.js';

type Coordinates = {
  latitude: number;
  longitude: number;
};

type ActiveDapper = {
  username: string;
  offeredServices: DapService[];
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
      'activeMode username offeredServices',
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
      );
      const previousSocket = previousDapper.socket;
      if (previousSocket && previousSocket !== socket) {
        handleDapperSocketDisconnect(user.id, previousSocket);
      }

      const dapper = getOrCreateDapper(
        user.id,
        user.username,
        offeredServices,
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
    handleDapperMessage(socket, session.userId, message);
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

function handleDapperMessage(
  socket: WebSocket,
  userId: string,
  message: Record<string, unknown>,
): void {
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
    deliverDap(userId, dapper, message.requestId);
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

    if (!location || !request || request.status !== 'pending') {
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
        crispinessRating: 2.5,
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
  if (
    !request ||
    request.status !== 'pending' ||
    request.offeredDapperId !== dapperId ||
    dapper.activeRequestId !== null ||
    !dapper.location ||
    distanceInKm(request.location, dapper.location) > 75
  ) {
    clearDapperOffer(request, false);
    if (request?.status === 'pending') {
      request.declinedDapperIds.add(dapperId);
      dispatchRequest(request);
      dispatchPendingRequests();
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
      crispinessRating: 2.5,
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

function deliverDap(
  dapperId: string,
  dapper: ActiveDapper,
  requestId: unknown,
): void {
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
): ActiveDapper {
  let dapper = activeDappers.get(userId);
  if (!dapper) {
    dapper = {
      username,
      offeredServices,
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
  }

  return dapper;
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
  activeMode?: AppMode;
  offeredServices?: DapService[];
  hasCompletedOnboarding?: boolean;
}): SerializedUser {
  return {
    id: user.id,
    username: user.username,
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

function sendAuthResponse(response: Response, user: SerializedUser) {
  const token = jwt.sign(
    { sub: user.id, username: user.username },
    jwtSecret,
    { expiresIn: 60 * 60 * 24 * 7 },
  );

  response.status(200).json({ token, user });
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
