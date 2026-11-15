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
  cancelOsuSso,
  cancelSteamSso,
  cancelStravaSso,
  completeOnboarding,
  deleteAccount,
  exchangeOsuSsoCode,
  exchangeSteamSsoCode,
  exchangeStravaSsoCode,
  fetchCurrentUser,
  fetchOsuSsoStatus,
  fetchSteamSsoStatus,
  fetchStravaSsoStatus,
  startOsuSso,
  startSteamSso,
  startStravaSso,
  updateDapperPreferences,
  updateActiveMode,
  updateProfile,
  type AppMode,
  type AuthMode,
  type AuthUser,
  type DapService,
  type OnboardingChoice,
  type OsuSsoStatusResponse,
  type ProfileUpdatePayload,
  type SteamSsoStatusResponse,
  type StravaSsoStatusResponse,
} from './src/api/auth';
import AuthFlowScreen, {
  HACKATHON_SUGGESTED_PW,
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
  osu: 'OSU',
};
type SsoProvider = 'steam' | 'strava' | 'osu';

const WEB_GLOBAL_CSS = `
  * {
    -webkit-tap-highlight-color: transparent !important;
  }
  input, button, select, textarea {
    outline: none !important;
  }
  input:focus, textarea:focus {
    outline: none !important;
    box-shadow: none !important;
  }
  ::selection {
    background: #000000 !important;
    color: #ffffff !important;
  }
  ::-moz-selection {
    background: #000000 !important;
    color: #ffffff !important;
  }
`;

function parseSsoCallbackUrl(rawUrl: string): {
  provider: SsoProvider | null;
  code: string | null;
  error: string | null;
} {
  try {
    const parsed = new URL(rawUrl);
    for (const provider of ['steam', 'strava', 'osu'] as const) {
      const code = parsed.searchParams.get(`${provider}_code`);
      const error = parsed.searchParams.get(`${provider}_error`);
      if (code !== null || error !== null) {
        return { provider, code, error };
      }
    }
    return { provider: null, code: null, error: null };
  } catch {
    return { provider: null, code: null, error: null };
  }
}

function consumeWebSsoCallbackParams(): {
  provider: SsoProvider | null;
  code: string | null;
  error: string | null;
} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { provider: null, code: null, error: null };
  }

  const url = new URL(window.location.href);
  let callback = { provider: null as SsoProvider | null, code: null as string | null, error: null as string | null };
  for (const provider of ['steam', 'strava', 'osu'] as const) {
    const code = url.searchParams.get(`${provider}_code`);
    const error = url.searchParams.get(`${provider}_error`);
    if (code !== null || error !== null) {
      callback = { provider, code, error };
      url.searchParams.delete(`${provider}_code`);
      url.searchParams.delete(`${provider}_error`);
    }
  }

  if (callback.provider) {
    const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return callback;
}

export default function App() {
  const [initialSsoCallback] = useState(consumeWebSsoCallbackParams);
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [error, setError] = useState<string | null>(initialSsoCallback.error);
  const [isRestoringSession, setIsRestoringSession] = useState(() =>
    Boolean(initialSsoCallback.code || loadAuthToken() || Platform.OS !== 'web'),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] =
    useState<SocialProvider | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [onboardingAction, setOnboardingAction] =
    useState<OnboardingAction | null>(null);
  const modeChangeInProgressRef = useRef(false);
  const ssoPollActiveRef = useRef(false);
  const activeSsoSessionRef = useRef<{
    provider: SsoProvider;
    state: string;
    pollToken: string;
  } | null>(null);
  const isExchangingSsoCodeRef = useRef(false);
  const handledSsoCodesRef = useRef<Set<string>>(new Set());
  const ssoAttemptIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const isLogin = mode === 'login';

  async function completeSsoSignInWithCode(
    provider: SsoProvider,
    code: string,
  ): Promise<void> {
    const handledCode = `${provider}:${code}`;
    if (
      !code ||
      handledSsoCodesRef.current.has(handledCode) ||
      isExchangingSsoCodeRef.current
    ) {
      return;
    }

    handledSsoCodesRef.current.add(handledCode);
    ssoAttemptIdRef.current += 1;
    isExchangingSsoCodeRef.current = true;
    ssoPollActiveRef.current = false;
    activeSsoSessionRef.current = null;

    try {
      const result =
        provider === 'steam'
          ? await exchangeSteamSsoCode(code)
          : provider === 'strava'
            ? await exchangeStravaSsoCode(code)
            : await exchangeOsuSsoCode(code);
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
            : `Unable to complete ${PROVIDER_LABELS[provider]} Sign-In.`,
        );
      }
    } finally {
      isExchangingSsoCodeRef.current = false;
      if (isMountedRef.current) {
        setPendingProvider(null);
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    let isActive = true;

    async function initializeSession() {
      let callbackProvider = initialSsoCallback.provider;
      let callbackCode = initialSsoCallback.code;
      let callbackError: string | null = null;

      if (!callbackCode && Platform.OS !== 'web') {
        try {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            const parsed = parseSsoCallbackUrl(initialUrl);
            callbackProvider = parsed.provider;
            callbackCode = parsed.code;
            callbackError = parsed.error;
          }
        } catch {
          // Ignore Linking.getInitialURL failures on unsupported environments.
        }
      }

      if (callbackError && isActive) {
        setError(callbackError);
      }

      if (callbackProvider && callbackCode) {
        await completeSsoSignInWithCode(callbackProvider, callbackCode);
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
      ssoPollActiveRef.current = false;
    };
  }, [initialSsoCallback.code, initialSsoCallback.provider]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const { provider, code, error: callbackError } = parseSsoCallbackUrl(url);

      if (provider && code) {
        void completeSsoSignInWithCode(provider, code);
        return;
      }

      if (callbackError) {
        ssoAttemptIdRef.current += 1;
        ssoPollActiveRef.current = false;
        activeSsoSessionRef.current = null;
        setPendingProvider(null);
        setError(callbackError);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  function signOut(nextError: string | null = null) {
    ssoPollActiveRef.current = false;
    activeSsoSessionRef.current = null;
    clearAuthToken();
    setUser(null);
    setPendingProvider(null);
    setOnboardingAction(null);
    setError(nextError);
  }

  async function handleCancelSso() {
    ssoAttemptIdRef.current += 1;
    ssoPollActiveRef.current = false;
    const activeSession = activeSsoSessionRef.current;
    activeSsoSessionRef.current = null;
    setPendingProvider(null);
    setError(null);

    if (activeSession) {
      const cancelSso =
        activeSession.provider === 'steam'
          ? cancelSteamSso
          : activeSession.provider === 'strava'
            ? cancelStravaSso
            : cancelOsuSso;
      await cancelSso(activeSession.state, activeSession.pollToken).catch(() => {});
    }
  }

  async function handleProviderPress(provider: SocialProvider) {
    if (provider !== 'steam' && provider !== 'strava' && provider !== 'osu') {
      setError(
        `${PROVIDER_LABELS[provider]} sign-in is coming soon. Please use Steam, Strava, OSU, or Log in / Sign up.`,
      );
      return;
    }

    const ssoProvider = provider;
    const attemptId = ++ssoAttemptIdRef.current;
    const isCurrentAttempt = () =>
      isMountedRef.current && ssoAttemptIdRef.current === attemptId;
    let startedSession: { state: string; pollToken: string } | null = null;
    setError(null);
    setPendingProvider(ssoProvider);

    try {
      const returnTo =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : `uberdaps://auth/${ssoProvider}`;

      const startSso =
        ssoProvider === 'steam'
          ? startSteamSso
          : ssoProvider === 'strava'
            ? startStravaSso
            : startOsuSso;
      const cancelSso =
        ssoProvider === 'steam'
          ? cancelSteamSso
          : ssoProvider === 'strava'
            ? cancelStravaSso
            : cancelOsuSso;
      const { authorizeUrl, state, pollToken } = await startSso(returnTo);
      if (!isCurrentAttempt()) {
        void cancelSso(state, pollToken).catch(() => {});
        return;
      }

      startedSession = { state, pollToken };
      activeSsoSessionRef.current = { ...startedSession, provider: ssoProvider };

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(authorizeUrl);
        return;
      }

      await Linking.openURL(authorizeUrl);
      if (!isCurrentAttempt()) {
        return;
      }
      ssoPollActiveRef.current = true;

      const deadline = Date.now() + 3 * 60 * 1000;
      let consecutivePollErrors = 0;
      while (
        ssoPollActiveRef.current &&
        isCurrentAttempt() &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!ssoPollActiveRef.current || !isCurrentAttempt()) {
          return;
        }

        let status:
          | SteamSsoStatusResponse
          | StravaSsoStatusResponse
          | OsuSsoStatusResponse;
        try {
          status =
            ssoProvider === 'steam'
              ? await fetchSteamSsoStatus(state, pollToken)
              : ssoProvider === 'strava'
                ? await fetchStravaSsoStatus(state, pollToken)
                : await fetchOsuSsoStatus(state, pollToken);
          consecutivePollErrors = 0;
        } catch (pollError) {
          if (!ssoPollActiveRef.current || !isCurrentAttempt()) {
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

        if (!ssoPollActiveRef.current || !isCurrentAttempt()) {
          return;
        }

        if (status.status === 'completed') {
          await completeSsoSignInWithCode(ssoProvider, status.code);
          return;
        }

        if (
          status.status === 'error' ||
          status.status === 'expired' ||
          status.status === 'cancelled'
        ) {
          activeSsoSessionRef.current = null;
          setError(status.message);
          setPendingProvider(null);
          ssoPollActiveRef.current = false;
          return;
        }
      }

      if (ssoPollActiveRef.current && isCurrentAttempt()) {
        ssoPollActiveRef.current = false;
        activeSsoSessionRef.current = null;
        setError(`${PROVIDER_LABELS[ssoProvider]} sign-in timed out. Please try again.`);
        setPendingProvider(null);
        await cancelSso(state, pollToken).catch(() => {});
      }
    } catch (ssoError) {
      if (!isCurrentAttempt()) {
        return;
      }
      ssoPollActiveRef.current = false;
      activeSsoSessionRef.current = null;
      setPendingProvider(null);
      setError(
        ssoError instanceof Error
          ? ssoError.message
          : `Unable to start ${PROVIDER_LABELS[ssoProvider]} Sign-In.`,
      );
      if (startedSession) {
        const cancelSso =
          ssoProvider === 'steam'
            ? cancelSteamSso
            : ssoProvider === 'strava'
              ? cancelStravaSso
              : cancelOsuSso;
        void cancelSso(startedSession.state, startedSession.pollToken).catch(() => {});
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
      let result;
      try {
        result = await authenticate(finalMode, finalUser, finalPass);
      } catch (authErr) {
        if (
          finalMode === 'login' &&
          authErr instanceof Error &&
          authErr.message.toLowerCase().includes('not found') &&
          finalPass === HACKATHON_SUGGESTED_PW
        ) {
          result = await authenticate('signup', finalUser, finalPass);
        } else {
          throw authErr;
        }
      }
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
        {Platform.OS === 'web' ? <style>{WEB_GLOBAL_CSS}</style> : null}
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
        {Platform.OS === 'web' ? <style>{WEB_GLOBAL_CSS}</style> : null}
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
        {Platform.OS === 'web' ? <style>{WEB_GLOBAL_CSS}</style> : null}
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
            stravaAvatar={user.stravaAvatar}
            stravaUsername={user.stravaUsername}
            osuAvatar={user.osuAvatar}
            osuUsername={user.osuUsername}
            token={user.token}
            username={user.username}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {Platform.OS === 'web' ? <style>{WEB_GLOBAL_CSS}</style> : null}
      <View style={[styles.app, styles.welcomeApp]}>
        <StatusBar style="dark" />
        <AuthFlowScreen
          error={error}
          isSubmitting={isSubmitting}
          onCancelProvider={() => void handleCancelSso()}
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
