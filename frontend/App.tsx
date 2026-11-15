import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
  completeOnboarding,
  deleteAccount,
  fetchCurrentUser,
  updateActiveMode,
  type AppMode,
  type AuthMode,
  type AuthUser,
} from './src/api/auth';
import AnimatedDapHands, {
  type AnimatedDapHandsHandle,
} from './src/components/AnimatedDapHands';
import MapScreen from './src/screens/MapScreen';
import OnboardingModeScreen, {
  type OnboardingAction,
} from './src/screens/OnboardingModeScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import {
  clearAuthToken,
  loadAuthToken,
  saveAuthToken,
} from './src/storage/session';

type SignedInUser = AuthUser & {
  token: string;
};

type UnauthenticatedView = 'welcome' | 'form';

export default function App() {
  const [authView, setAuthView] = useState<UnauthenticatedView>('welcome');
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(() =>
    Boolean(loadAuthToken()),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [onboardingAction, setOnboardingAction] =
    useState<OnboardingAction | null>(null);
  const formDapHandsRef = useRef<AnimatedDapHandsHandle>(null);

  const isLogin = mode === 'login';

  useEffect(() => {
    const storedToken = loadAuthToken();

    if (!storedToken) {
      setIsRestoringSession(false);
      return;
    }

    let isActive = true;

    async function restoreSession(token: string) {
      try {
        const result = await fetchCurrentUser(token);
        if (isActive) {
          setUser({ ...result.user, token });
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

    void restoreSession(storedToken);

    return () => {
      isActive = false;
    };
  }, []);

  function signOut(nextError: string | null = null) {
    clearAuthToken();
    setUser(null);
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
            error={error}
            isSubmitting={isSubmitting}
            onChangeMode={(nextMode) => void handleChangeMapMode(nextMode)}
            onDeleteAccount={() => void removeAccount()}
            onSignOut={() => signOut()}
            token={user.token}
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
            onPressLogin={() => openAuthForm('login')}
            onPressSignup={() => openAuthForm('signup')}
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
