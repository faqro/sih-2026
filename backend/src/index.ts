import 'dotenv/config';

import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';

import { User, type AccountType } from './models/User.js';

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
    });

    sendAuthResponse(response, user.id, user.username, user.accountType);
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

    sendAuthResponse(response, user.id, user.username, user.accountType);
  } catch (error) {
    console.error('Unable to sign in:', error);
    response.status(500).json({ message: 'Unable to sign in.' });
  }
});

app.delete('/auth/account', async (request, response) => {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ message: 'Authentication is required.' });
    return;
  }

  let userId: string;

  try {
    const payload = jwt.verify(authorization.slice(7), jwtSecret);

    if (typeof payload !== 'object' || typeof payload.sub !== 'string') {
      response.status(401).json({ message: 'Invalid authentication token.' });
      return;
    }

    userId = payload.sub;
  } catch {
    response.status(401).json({ message: 'Invalid authentication token.' });
    return;
  }

  try {
    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      response.status(404).json({ message: 'User not found.' });
      return;
    }

    const activeDapper = activeDappers.get(userId);
    activeDappers.delete(userId);
    activeDapper?.socket.close(1008, 'Account deleted.');
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
    const user = await User.findById(tokenUserId).select('accountType');

    if (!user || user.accountType !== 'dapper') {
      socket.close(1008, 'Only dapper accounts can stream location.');
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

function removeActiveDapper(userId: string, socket: WebSocket): void {
  const activeDapper = activeDappers.get(userId);

  if (activeDapper?.socket === socket) {
    activeDappers.delete(userId);
  }
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

function sendAuthResponse(
  response: Response,
  userId: string,
  username: string,
  accountType: AccountType,
) {
  const token = jwt.sign({ sub: userId, username }, jwtSecret, {
    expiresIn: 60 * 60 * 24 * 7,
  });

  response.status(200).json({
    token,
    user: { id: userId, username, accountType },
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
