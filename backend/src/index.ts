import 'dotenv/config';

import cors from 'cors';
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import { User, type AccountType } from './models/User.js';

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
