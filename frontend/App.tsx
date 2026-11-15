import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ApiError,
  authenticate,
  cancelSteamSso,
  completeOnboarding,
  deleteAccount,
  exchangeSteamSsoCode,
  fetchCurrentUser,
  fetchSteamSsoStatus,
  startSteamSso,
  updateDapperPreferences,
  updateActiveMode,
  updateProfile,
  type AppMode,
  type AuthMode,
  type AuthUser,
  type DapService,
  type OnboardingChoice,
  type ProfileUpdatePayload,
  type SteamSsoStatusResponse,
} from './src/api/auth';
import AuthFlowScreen, {
  type SocialProvider,
} from './src/screens/AuthFlowScreen';
import MapScreen from './src/screens/MapScreen';
import OnboardingModeScreen, {
  type OnboardingAction,
} from './src/screens/OnboardingModeScreen';
import {
  clearAuthToken,
  loadAuthToken,
  saveAuthToken,
} from './src/storage/session';

type SignedInUser = AuthUser & {
  token: string;
};

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  steam: 'Steam',
  strava: 'Strava',
  spotify: 'Spotify',
  osu: 'OSU',
};

function parseSteamCallbackUrl(rawUrl: string): {
  code: string | null;
  error: string | null;
} {
  try {
    const parsed = new URL(rawUrl);
    return {
      code: parsed.searchParams.get('steam_code'),
      error: parsed.searchParams.get('steam_error'),
    };
  } catch {
    return { code: null, error: null };
  }
}

function consumeWebSteamCallbackParams(): {
  code: string | null;
  error: string | null;
} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { code: null, error: null };
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get('steam_code');
  const error = url.searchParams.get('steam_error');

  if (code !== null || error !== null) {
    url.searchParams.delete('steam_code');
    url.searchParams.delete('steam_error');
    const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return { code, error };
}

export default function App() {
  const [initialSteamCallback] = useState(consumeWebSteamCallbackParams);
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [error, setError] = useState<string | null>(initialSteamCallback.error);
  const [isRestoringSession, setIsRestoringSession] = useState(() =>
    Boolean(initialSteamCallback.code || loadAuthToken() || Platform.OS !== 'web'),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] =
    useState<SocialProvider | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [onboardingAction, setOnboardingAction] =
    useState<OnboardingAction | null>(null);
  const modeChangeInProgressRef = useRef(false);
  const steamPollActiveRef = useRef(false);
  const activeSteamSessionRef = useRef<{
    state: string;
    pollToken: string;
  } | null>(null);
  const isExchangingSteamCodeRef = useRef(false);
  const handledSteamCodesRef = useRef<Set<string>>(new Set());
  const steamAttemptIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const isLogin = mode === 'login';

  async function completeSteamSignInWithCode(code: string): Promise<void> {
    if (
      !code ||
      handledSteamCodesRef.current.has(code) ||
      isExchangingSteamCodeRef.current
    ) {
      return;
    }

    handledSteamCodesRef.current.add(code);
    steamAttemptIdRef.current += 1;
    isExchangingSteamCodeRef.current = true;
    steamPollActiveRef.current = false;
    activeSteamSessionRef.current = null;

    try {
      const result = await exchangeSteamSsoCode(code);
      saveAuthToken(result.token);
      if (isMountedRef.current) {
        setUser({ ...result.user, token: result.token });
        setError(null);
      }
    } catch (exchangeError) {
      if (isMountedRef.current) {
        setError(
          exchangeError instanceof Error
            ? exchangeError.message
            : 'Unable to complete Steam Sign-In.',
        );
      }
    } finally {
      isExchangingSteamCodeRef.current = false;
      if (isMountedRef.current) {
        setPendingProvider(null);
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    let isActive = true;

    async function initializeSession() {
      let steamCode = initialSteamCallback.code;
      let steamCallbackError: string | null = null;

      if (!steamCode && Platform.OS !== 'web') {
        try {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            const parsed = parseSteamCallbackUrl(initialUrl);
            steamCode = parsed.code;
            steamCallbackError = parsed.error;
          }
        } catch {
          // Ignore Linking.getInitialURL failures on unsupported environments.
        }
      }

      if (steamCallbackError && isActive) {
        setError(steamCallbackError);
      }

      if (steamCode) {
        await completeSteamSignInWithCode(steamCode);
        if (isActive) {
          setIsRestoringSession(false);
        }
        return;
      }

      const storedToken = loadAuthToken();
      if (!storedToken) {
        if (isActive) {
          setIsRestoringSession(false);
        }
        return;
      }

      try {
        const result = await fetchCurrentUser(storedToken);
        if (isActive) {
          setUser({ ...result.user, token: storedToken });
        }
      } catch (restoreError) {
        clearAuthToken();
        if (
          isActive &&
          !(
            restoreError instanceof ApiError &&
            (restoreError.status === 401 || restoreError.status === 404)
          )
        ) {
          setError('Session expired or backend unavailable. Please sign in again.');
        }
      } finally {
        if (isActive) {
          setIsRestoringSession(false);
        }
      }
    }

    void initializeSession();

    return () => {
      isActive = false;
      isMountedRef.current = false;
      steamPollActiveRef.current = false;
    };
  }, [initialSteamCallback.code]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const { code, error: callbackError } = parseSteamCallbackUrl(url);

      if (code) {
        void completeSteamSignInWithCode(code);
        return;
      }

      if (callbackError) {
        steamAttemptIdRef.current += 1;
        steamPollActiveRef.current = false;
        activeSteamSessionRef.current = null;
        setPendingProvider(null);
        setError(callbackError);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  function signOut(nextError: string | null = null) {
    steamPollActiveRef.current = false;
    activeSteamSessionRef.current = null;
    clearAuthToken();
    setUser(null);
    setPendingProvider(null);
    setOnboardingAction(null);
    setError(nextError);
  }

  async function handleCancelSteamSso() {
    steamAttemptIdRef.current += 1;
    steamPollActiveRef.current = false;
    const activeSession = activeSteamSessionRef.current;
    activeSteamSessionRef.current = null;
    setPendingProvider(null);
    setError(null);

    if (activeSession) {
      await cancelSteamSso(activeSession.state, activeSession.pollToken).catch(
        () => {},
      );
    }
  }

  async function handleProviderPress(provider: SocialProvider) {
    if (provider !== 'steam') {
      setError(
        `${PROVIDER_LABELS[provider]} sign-in is coming soon. Please use Steam or Log in / Sign up.`,
      );
      return;
    }

    const attemptId = ++steamAttemptIdRef.current;
    const isCurrentAttempt = () =>
      isMountedRef.current && steamAttemptIdRef.current === attemptId;
    let startedSession: { state: string; pollToken: string } | null = null;
    setError(null);
    setPendingProvider('steam');

    try {
      const returnTo =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : 'uberdaps://auth/steam';

      const { authorizeUrl, state, pollToken } = await startSteamSso(returnTo);
      if (!isCurrentAttempt()) {
        void cancelSteamSso(state, pollToken).catch(() => {});
        return;
      }

      startedSession = { state, pollToken };
      activeSteamSessionRef.current = startedSession;

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(authorizeUrl);
        return;
      }

      await Linking.openURL(authorizeUrl);
      if (!isCurrentAttempt()) {
        return;
      }
      steamPollActiveRef.current = true;

      const deadline = Date.now() + 3 * 60 * 1000;
      let consecutivePollErrors = 0;
      while (
        steamPollActiveRef.current &&
        isCurrentAttempt() &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!steamPollActiveRef.current || !isCurrentAttempt()) {
          return;
        }

        let status: SteamSsoStatusResponse;
        try {
          status = await fetchSteamSsoStatus(state, pollToken);
          consecutivePollErrors = 0;
        } catch (pollError) {
          if (!steamPollActiveRef.current || !isCurrentAttempt()) {
            return;
          }
          if (
            pollError instanceof ApiError &&
            pollError.status >= 400 &&
            pollError.status < 500
          ) {
            throw pollError;
          }
          consecutivePollErrors += 1;
          if (consecutivePollErrors >= 5) {
            throw pollError;
          }
          continue;
        }

        if (!steamPollActiveRef.current || !isCurrentAttempt()) {
          return;
        }

        if (status.status === 'completed') {
          await completeSteamSignInWithCode(status.code);
          return;
        }

        if (
          status.status === 'error' ||
          status.status === 'expired' ||
          status.status === 'cancelled'
        ) {
          activeSteamSessionRef.current = null;
          setError(status.message);
          setPendingProvider(null);
          steamPollActiveRef.current = false;
          return;
        }
      }

      if (steamPollActiveRef.current && isCurrentAttempt()) {
        steamPollActiveRef.current = false;
        activeSteamSessionRef.current = null;
        setError('Steam sign-in timed out. Please try again.');
        setPendingProvider(null);
        await cancelSteamSso(state, pollToken).catch(() => {});
      }
    } catch (ssoError) {
      if (!isCurrentAttempt()) {
        return;
      }
      steamPollActiveRef.current = false;
      activeSteamSessionRef.current = null;
      setPendingProvider(null);
      setError(
        ssoError instanceof Error
          ? ssoError.message
          : 'Unable to start Steam Sign-In.',
      );
      if (startedSession) {
        void cancelSteamSso(
          startedSession.state,
          startedSession.pollToken,
        ).catch(() => {});
      }
    }
  }

  function handleSessionError(err: unknown, fallbackMessage: string) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
      signOut('Your session expired. Please sign in again.');
      return;
    }

    setError(err instanceof Error ? err.message : fallbackMessage);
  }

  async function submit(customMode?: AuthMode, overrideUser?: string, overridePass?: string) {
    const finalMode = customMode ?? mode;
    const finalUser = overrideUser ?? username;
    const finalPass = overridePass ?? password;

    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authenticate(finalMode, finalUser, finalPass);
      saveAuthToken(result.token);
      setUser({ ...result.user, token: result.token });
      setPassword('');
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to complete your request.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOnboardingChoice(
    action: OnboardingAction,
    choice: OnboardingChoice,
  ) {
    if (!user) {
      return;
    }

    setError(null);
    setOnboardingAction(action);

    try {
      const result = await completeOnboarding(user.token, choice);
      setUser((current) =>
        current ? { ...result.user, token: current.token } : null,
      );
    } catch (onboardingError) {
      handleSessionError(onboardingError, 'Unable to save your setup choice.');
    } finally {
      setOnboardingAction(null);
    }
  }

  async function handleSaveDapperPreferences(
    offeredServices: DapService[],
  ): Promise<boolean> {
    if (!user) {
      return false;
    }

    setError(null);
    setIsSavingPreferences(true);

    try {
      const result = await updateDapperPreferences(user.token, offeredServices);
      setUser((current) =>
        current ? { ...result.user, token: current.token } : null,
      );
      return true;
    } catch (preferencesError) {
      handleSessionError(
        preferencesError,
        'Unable to save dapper preferences.',
      );
      return false;
    } finally {
      setIsSavingPreferences(false);
    }
  }

  async function handleUpdateProfile(
    payload: ProfileUpdatePayload,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!user) {
      return { ok: false, error: 'You must be signed in.' };
    }

    try {
      const result = await updateProfile(user.token, payload);
      saveAuthToken(result.token);
      setUser({ ...result.user, token: result.token });
      return { ok: true };
    } catch (updateError) {
      if (
        updateError instanceof ApiError &&
        updateError.status === 401 &&
        updateError.message.toLowerCase().includes('token')
      ) {
        signOut('Your session expired. Please sign in again.');
      }
      return {
        ok: false,
        error:
          updateError instanceof Error
            ? updateError.message
            : 'Unable to update profile settings.',
      };
    }
  }

  function handleRatingReceived(payload: {
    crispinessRating: number;
    crispinessRatingCount: number;
  }) {
    setUser((current) =>
      current
        ? {
            ...current,
            crispinessRating: payload.crispinessRating,
            crispinessRatingCount: payload.crispinessRatingCount,
          }
        : null,
    );
  }

  async function handleChangeMapMode(nextMode: AppMode) {
    if (
      !user ||
      user.activeMode === nextMode ||
      modeChangeInProgressRef.current
    ) {
      return;
    }

    const previousMode = user.activeMode;
    modeChangeInProgressRef.current = true;
    setIsChangingMode(true);
    setError(null);
    setUser((current) =>
      current ? { ...current, activeMode: nextMode } : null,
    );

    try {
      const result = await updateActiveMode(user.token, nextMode);
      setUser((current) =>
        current && current.activeMode === nextMode
          ? { ...result.user, token: current.token }
          : current,
      );
    } catch (switchError) {
      setUser((current) =>
        current && current.activeMode === nextMode
          ? { ...current, activeMode: previousMode }
          : current,
      );
      handleSessionError(switchError, 'Unable to switch map mode.');
    } finally {
      modeChangeInProgressRef.current = false;
      setIsChangingMode(false);
    }
  }

  async function removeAccount() {
    if (!user) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await deleteAccount(user.token);
      clearAuthToken();
      setUser(null);
      setMode('login');
      setUsername('');
      setPassword('');
    } catch (deleteError) {
      handleSessionError(deleteError, 'Unable to delete your account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isRestoringSession) {
    return (
      <View style={styles.page}>
        <SafeAreaView style={styles.app}>
          <StatusBar style="dark" />
          <View style={styles.loadingState}>
            <ActivityIndicator color="#000000" size="large" />
            <Text style={styles.loadingText}>Restoring your session...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (user && !user.hasCompletedOnboarding) {
    return (
      <View style={styles.page}>
        <View style={styles.app}>
          <StatusBar style="dark" />
          <OnboardingModeScreen
            error={error}
            pendingAction={onboardingAction}
            onSelectMode={(selectedMode, offeredServices) =>
              void handleOnboardingChoice(
                selectedMode,
                selectedMode === 'dapper'
                  ? { mode: 'dapper', offeredServices }
                  : { mode: 'order' },
              )
            }
            onSignOut={() => signOut()}
            onSkip={() => void handleOnboardingChoice('skip', { skip: true })}
          />
        </View>
      </View>
    );
  }

  if (user) {
    return (
      <View style={styles.page}>
        <View style={styles.app}>
          <StatusBar style="dark" />
          <MapScreen
            activeMode={user.activeMode}
            authProvider={user.authProvider}
            crispinessRating={user.crispinessRating}
            crispinessRatingCount={user.crispinessRatingCount}
            error={error}
            isChangingMode={isChangingMode}
            isSavingPreferences={isSavingPreferences}
            isSubmitting={isSubmitting}
            name={user.name}
            offeredServices={user.offeredServices}
            onChangeMode={(nextMode) => void handleChangeMapMode(nextMode)}
            onDeleteAccount={() => void removeAccount()}
            onRatingReceived={handleRatingReceived}
            onSaveDapperPreferences={handleSaveDapperPreferences}
            onSignOut={() => signOut()}
            onUpdateProfile={handleUpdateProfile}
            steamAvatar={user.steamAvatar}
            steamUsername={user.steamUsername}
            token={user.token}
            username={user.username}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={[styles.app, styles.welcomeApp]}>
        <StatusBar style="dark" />
        <AuthFlowScreen
          error={error}
          isSubmitting={isSubmitting}
          onCancelProvider={() => void handleCancelSteamSso()}
          onClearError={() => setError(null)}
          onPressProvider={(provider) => void handleProviderPress(provider)}
          onSubmit={(nextMode, nextUser, nextPass) => {
            setMode(nextMode);
            setUsername(nextUser);
            setPassword(nextPass);
            void submit(nextMode, nextUser, nextPass);
          }}
          pendingProvider={pendingProvider}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  app: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#ffffff',
  },
  welcomeApp: {
    backgroundColor: '#ffffff',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
});
