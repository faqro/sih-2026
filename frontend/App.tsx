import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  ApiError,
  authenticate,
  cancelChessSso,
  completeOnboarding,
  deleteAccount,
  exchangeChessSsoCode,
  fetchChessSsoStatus,
  fetchCurrentUser,
  startChessSso,
  updateActiveMode,
  type AppMode,
  type AuthMode,
  type AuthUser,
  type ChessSsoStatusResponse,
} from './src/api/auth';
import AnimatedDapHands, {
  type AnimatedDapHandsHandle,
} from './src/components/AnimatedDapHands';
import MapScreen from './src/screens/MapScreen';
import OnboardingModeScreen, {
  type OnboardingAction,
} from './src/screens/OnboardingModeScreen';
import WelcomeScreen, { type SocialProvider } from './src/screens/WelcomeScreen';
import {
  clearAuthToken,
  loadAuthToken,
  saveAuthToken,
} from './src/storage/session';

type SignedInUser = AuthUser & {
  token: string;
};

type UnauthenticatedView = 'welcome' | 'form';

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  chess: 'Chess.com',
  steam: 'Steam',
  strava: 'Strava',
  spotify: 'Spotify',
  osu: 'OSU',
};

function parseChessCallbackUrl(rawUrl: string): {
  code: string | null;
  error: string | null;
} {
  try {
    const parsed = new URL(rawUrl);
    return {
      code: parsed.searchParams.get('chess_code'),
      error: parsed.searchParams.get('chess_error'),
    };
  } catch {
    return { code: null, error: null };
  }
}

function consumeWebChessCallbackParams(): {
  code: string | null;
  error: string | null;
} {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { code: null, error: null };
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get('chess_code');
  const error = url.searchParams.get('chess_error');

  if (code !== null || error !== null) {
    url.searchParams.delete('chess_code');
    url.searchParams.delete('chess_error');
    const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return { code, error };
}

export default function App() {
  const [initialChessCallback] = useState(consumeWebChessCallbackParams);
  const [authView, setAuthView] = useState<UnauthenticatedView>('welcome');
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [error, setError] = useState<string | null>(initialChessCallback.error);
  const [isRestoringSession, setIsRestoringSession] = useState(() =>
    Boolean(initialChessCallback.code || loadAuthToken() || Platform.OS !== 'web'),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] =
    useState<SocialProvider | null>(null);
  const [onboardingAction, setOnboardingAction] =
    useState<OnboardingAction | null>(null);
  const chessPollActiveRef = useRef(false);
  const activeChessSessionRef = useRef<{
    state: string;
    pollToken: string;
  } | null>(null);
  const isExchangingChessCodeRef = useRef(false);
  const handledChessCodesRef = useRef<Set<string>>(new Set());
  const chessAttemptIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const formDapHandsRef = useRef<AnimatedDapHandsHandle>(null);

  const isLogin = mode === 'login';

  async function completeChessSignInWithCode(code: string): Promise<void> {
    if (
      !code ||
      handledChessCodesRef.current.has(code) ||
      isExchangingChessCodeRef.current
    ) {
      return;
    }

    handledChessCodesRef.current.add(code);
    chessAttemptIdRef.current += 1;
    isExchangingChessCodeRef.current = true;
    chessPollActiveRef.current = false;
    activeChessSessionRef.current = null;

    try {
      const result = await exchangeChessSsoCode(code);
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
            : 'Unable to complete Chess.com Sign-In.',
        );
      }
    } finally {
      isExchangingChessCodeRef.current = false;
      if (isMountedRef.current) {
        setPendingProvider(null);
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    let isActive = true;

    async function initializeSession() {
      let chessCode = initialChessCallback.code;
      let chessCallbackError: string | null = null;

      if (!chessCode && Platform.OS !== 'web') {
        try {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            const parsed = parseChessCallbackUrl(initialUrl);
            chessCode = parsed.code;
            chessCallbackError = parsed.error;
          }
        } catch {
          // Ignore Linking.getInitialURL failures on unsupported environments.
        }
      }

      if (chessCallbackError && isActive) {
        setError(chessCallbackError);
      }

      if (chessCode) {
        await completeChessSignInWithCode(chessCode);
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
      chessPollActiveRef.current = false;
    };
  }, [initialChessCallback.code]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const { code, error: callbackError } = parseChessCallbackUrl(url);

      if (code) {
        void completeChessSignInWithCode(code);
        return;
      }

      if (callbackError) {
        chessAttemptIdRef.current += 1;
        chessPollActiveRef.current = false;
        activeChessSessionRef.current = null;
        setPendingProvider(null);
        setError(callbackError);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  function signOut(nextError: string | null = null) {
    chessPollActiveRef.current = false;
    activeChessSessionRef.current = null;
    clearAuthToken();
    setUser(null);
    setPendingProvider(null);
    setOnboardingAction(null);
    setAuthView('welcome');
    setError(nextError);
  }

  function handleSessionError(err: unknown, fallbackMessage: string) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
      signOut('Your session expired. Please sign in again.');
      return;
    }

    setError(err instanceof Error ? err.message : fallbackMessage);
  }

  async function submit(overrideUser?: string, overridePass?: string) {
    const finalUser = overrideUser ?? username;
    const finalPass = overridePass ?? password;

    setError(null);
    setIsSubmitting(true);
    void formDapHandsRef.current?.triggerDap();

    try {
      const result = await authenticate(mode, finalUser, finalPass);
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

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    formDapHandsRef.current?.reset();
  }

  function openAuthForm(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setAuthView('form');
  }

  async function handleCancelChessSso() {
    chessAttemptIdRef.current += 1;
    chessPollActiveRef.current = false;
    const activeSession = activeChessSessionRef.current;
    activeChessSessionRef.current = null;
    setPendingProvider(null);
    setError(null);

    if (activeSession) {
      await cancelChessSso(activeSession.state, activeSession.pollToken).catch(
        () => {},
      );
    }
  }

  async function handleProviderPress(provider: SocialProvider) {
    if (provider !== 'chess') {
      setError(
        `${PROVIDER_LABELS[provider]} sign-in is coming soon. Please use Chess.com or Log in / Sign up.`,
      );
      return;
    }

    const attemptId = ++chessAttemptIdRef.current;
    const isCurrentAttempt = () =>
      isMountedRef.current && chessAttemptIdRef.current === attemptId;
    let startedSession: { state: string; pollToken: string } | null = null;
    setError(null);
    setPendingProvider('chess');

    try {
      const returnTo =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : 'uberdaps://auth/chess';

      const { authorizeUrl, state, pollToken } = await startChessSso(returnTo);
      if (!isCurrentAttempt()) {
        void cancelChessSso(state, pollToken).catch(() => {});
        return;
      }

      startedSession = { state, pollToken };
      activeChessSessionRef.current = startedSession;

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(authorizeUrl);
        return;
      }

      await Linking.openURL(authorizeUrl);
      if (!isCurrentAttempt()) {
        return;
      }
      chessPollActiveRef.current = true;

      const deadline = Date.now() + 3 * 60 * 1000;
      let consecutivePollErrors = 0;
      while (
        chessPollActiveRef.current &&
        isCurrentAttempt() &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!chessPollActiveRef.current || !isCurrentAttempt()) {
          return;
        }

        let status: ChessSsoStatusResponse;
        try {
          status = await fetchChessSsoStatus(state, pollToken);
          consecutivePollErrors = 0;
        } catch (pollError) {
          if (!chessPollActiveRef.current || !isCurrentAttempt()) {
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

        if (!chessPollActiveRef.current || !isCurrentAttempt()) {
          return;
        }

        if (status.status === 'completed') {
          await completeChessSignInWithCode(status.code);
          return;
        }

        if (
          status.status === 'error' ||
          status.status === 'expired' ||
          status.status === 'cancelled'
        ) {
          activeChessSessionRef.current = null;
          setError(status.message);
          setPendingProvider(null);
          chessPollActiveRef.current = false;
          return;
        }
      }

      if (chessPollActiveRef.current && isCurrentAttempt()) {
        chessPollActiveRef.current = false;
        activeChessSessionRef.current = null;
        setError('Chess.com sign-in timed out. Please try again.');
        setPendingProvider(null);
        await cancelChessSso(state, pollToken).catch(() => {});
      }
    } catch (ssoError) {
      if (!isCurrentAttempt()) {
        return;
      }
      chessPollActiveRef.current = false;
      activeChessSessionRef.current = null;
      setPendingProvider(null);
      setError(
        ssoError instanceof Error
          ? ssoError.message
          : 'Unable to start Chess.com Sign-In.',
      );
      if (startedSession) {
        void cancelChessSso(
          startedSession.state,
          startedSession.pollToken,
        ).catch(() => {});
      }
    }
  }

  async function handleOnboardingChoice(
    action: OnboardingAction,
    choice: { mode: AppMode } | { skip: true },
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

  async function handleChangeMapMode(nextMode: AppMode) {
    if (!user || user.activeMode === nextMode) {
      return;
    }

    const previousMode = user.activeMode;
    setError(null);
    setUser((current) =>
      current ? { ...current, activeMode: nextMode } : null,
    );

    try {
      const result = await updateActiveMode(user.token, nextMode);
      setUser((current) =>
        current ? { ...result.user, token: current.token } : null,
      );
    } catch (switchError) {
      setUser((current) =>
        current && current.activeMode === nextMode
          ? { ...current, activeMode: previousMode }
          : current,
      );
      handleSessionError(switchError, 'Unable to switch map mode.');
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
      setAuthView('welcome');
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
            onSelectMode={(selectedMode) =>
              void handleOnboardingChoice(selectedMode, { mode: selectedMode })
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
            chessAvatar={user.chessAvatar}
            chessUsername={user.chessUsername}
            error={error}
            isSubmitting={isSubmitting}
            onChangeMode={(nextMode) => void handleChangeMapMode(nextMode)}
            onDeleteAccount={() => void removeAccount()}
            onSignOut={() => signOut()}
            token={user.token}
            username={user.username}
          />
        </View>
      </View>
    );
  }

  if (authView === 'welcome') {
    return (
      <View style={styles.page}>
        <View style={[styles.app, styles.welcomeApp]}>
          <StatusBar style="dark" />
          <WelcomeScreen
            error={error}
            onCancelProvider={() => void handleCancelChessSso()}
            onPressLogin={() => openAuthForm('login')}
            onPressProvider={(provider) => void handleProviderPress(provider)}
            onPressSignup={() => openAuthForm('signup')}
            pendingProvider={pendingProvider}
          />
        </View>
      </View>
    );
  }

  function renderAuthError(message: string) {
    const didYouMeanIndex = message.indexOf('Did you mean');

    if (didYouMeanIndex > 0) {
      const primary = message.slice(0, didYouMeanIndex).trim();
      const suggestion = message.slice(didYouMeanIndex).trim();

      return (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{primary}</Text>
          <Text style={[styles.error, styles.errorSuggestion]}>{suggestion}</Text>
        </View>
      );
    }

    return (
      <View style={styles.errorBlock}>
        <Text style={styles.error}>{message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <SafeAreaView style={[styles.app, styles.welcomeApp]}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoider}
        >
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.authScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.authHeaderRow}>
              <View>
                <Text style={styles.welcomeTitle}>Welcome to</Text>
                <Text style={styles.brandTitle}>UberDaps</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                hitSlop={8}
                onPress={() => {
                  setError(null);
                  setAuthView('welcome');
                }}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>← Back</Text>
              </Pressable>
            </View>

            <View style={styles.claspedHandsContainer}>
              <AnimatedDapHands ref={formDapHandsRef} />
            </View>

            <Text style={styles.authSectionTitle}>
              {isLogin ? 'Log in to UberDaps' : 'Sign up for UberDaps'}
            </Text>

            <View style={styles.form}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect={false}
                editable={!isSubmitting}
                onChangeText={setUsername}
                placeholder=""
                placeholderTextColor="#8b94a7"
                style={styles.input}
                value={username}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                editable={!isSubmitting}
                onChangeText={setPassword}
                placeholder=""
                placeholderTextColor="#8b94a7"
                secureTextEntry
                style={styles.input}
                value={password}
              />

              {error ? renderAuthError(error) : null}

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !isSubmitting && styles.primaryButtonPressed,
                  isSubmitting && styles.primaryButtonDisabled,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isLogin ? 'Log in' : 'Sign up'}
                  </Text>
                )}
              </Pressable>
            </View>

            <View style={styles.modePrompt}>
              <Text style={styles.modePromptText}>
                {isLogin ? 'New here?' : 'Already have an account?'}
              </Text>
              <Pressable
                disabled={isSubmitting}
                onPress={() => switchMode(isLogin ? 'signup' : 'login')}
              >
                <Text style={styles.modeLink}>
                  {isLogin ? 'Sign up' : 'Log in'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

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
  keyboardAvoider: {
    flex: 1,
  },
  authScrollContent: {
    flexGrow: 1,
    paddingTop: 22,
    paddingBottom: 32,
    backgroundColor: '#ffffff',
  },
  authHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  welcomeTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 38,
    fontWeight: '400',
    lineHeight: 44,
    letterSpacing: -0.9,
  },
  brandTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 42,
    fontWeight: '700',
    lineHeight: 46,
    letterSpacing: -1.1,
  },
  backButton: {
    paddingTop: 6,
  },
  backButtonText: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  claspedHandsContainer: {
    width: '100%',
    marginTop: 18,
    marginBottom: 24,
  },
  claspedHandsImage: {
    width: '100%',
    height: undefined,
    aspectRatio: 471 / 156,
  },
  authSectionTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 20,
  },
  form: {
    paddingHorizontal: 20,
  },
  label: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  input: {
    height: 60,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 22,
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    backgroundColor: '#eaeaea',
  },
  errorBlock: {
    alignItems: 'center',
    gap: 8,
    marginTop: -6,
    marginBottom: 22,
  },
  error: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    textAlign: 'center',
  },
  errorSuggestion: {
    fontSize: 16,
    lineHeight: 22,
    textDecorationLine: 'underline',
  },
  primaryButton: {
    alignSelf: 'center',
    minWidth: 180,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 40,
    marginTop: 4,
    backgroundColor: '#000000',
  },
  primaryButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  modePrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 22,
  },
  modePromptText: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 13,
  },
  modeLink: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '700',
  },
});
