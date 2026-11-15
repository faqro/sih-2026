export type AuthMode = 'login' | 'signup';

type AuthResponse = {
  token: string;
  user: {
    id: string;
    username: string;
  };
};

const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');

export async function authenticate(
  mode: AuthMode,
  username: string,
  password: string,
): Promise<AuthResponse> {
  const response = await fetch(`${apiUrl}/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : 'Unable to complete your request.';
    throw new Error(message);
  }

  return body as AuthResponse;
}

export async function deleteAccount(token: string): Promise<void> {
  const response = await fetch(`${apiUrl}/auth/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : 'Unable to delete your account.';
    throw new Error(message);
  }
}
