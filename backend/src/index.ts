import 'dotenv/config';

import cors from 'cors';
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import { User, type AppMode } from './models/User.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const mongoUri = requireEnvironmentVariable('MONGODB_URI');
const jwtSecret = requireEnvironmentVariable('JWT_SECRET');

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

type SerializedUser = {
  id: string;
  username: string;
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
    const payload = jwt.verify(authorization.slice(7), jwtSecret);

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.sub !== 'string'
    ) {
      response.status(401).json({ message: 'Invalid authentication token.' });
      return null;
    }

    return payload.sub;
  } catch {
    response.status(401).json({ message: 'Invalid authentication token.' });
    return null;
  }
}

function serializeUser(user: {
  id: string;
  username: string;
  activeMode?: AppMode;
  hasCompletedOnboarding?: boolean;
}): SerializedUser {
  return {
    id: user.id,
    username: user.username,
    activeMode: user.activeMode === 'dapper' ? 'dapper' : 'order',
    hasCompletedOnboarding: Boolean(user.hasCompletedOnboarding),
  };
}

function isAppMode(value: unknown): value is AppMode {
  return value === 'order' || value === 'dapper';
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

async function startServer() {
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

void startServer().catch((error: unknown) => {
  console.error('Unable to start backend:', error);
  process.exitCode = 1;
});
