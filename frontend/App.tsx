import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
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

export default function App() {
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
    setError(nextError);
  }

  function handleSessionError(err: unknown, fallbackMessage: string) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
      signOut('Your session expired. Please sign in again.');
      return;
    }

    setError(err instanceof Error ? err.message : fallbackMessage);
  }

  async function submit() {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authenticate(mode, username, password);
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
            <ActivityIndicator color="#314b9a" size="large" />
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
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.app}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoider}
        >
          <View style={styles.content}>
            <View style={styles.brandMark}>
              <Image
                accessibilityLabel="Uber DAPS logo"
                resizeMode="cover"
                source={require('./assets/uberdaps-logo.jpg')}
                style={styles.brandMarkImage}
              />
            </View>
            <Text style={styles.title}>
              {isLogin ? 'Welcome back' : 'Create your account'}
            </Text>
            <Text style={styles.subtitle}>
              {isLogin
                ? 'Sign in to continue to your workspace.'
                : 'Use a username and password to get started.'}
            </Text>

            <View style={styles.form}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect={false}
                editable={!isSubmitting}
                onChangeText={setUsername}
                placeholder="your_username"
                placeholderTextColor="#8b94a7"
                style={styles.input}
                value={username}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                editable={!isSubmitting}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                placeholderTextColor="#8b94a7"
                secureTextEntry
                style={styles.input}
                value={password}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void submit()}
                style={[
                  styles.primaryButton,
                  isSubmitting && styles.primaryButtonDisabled,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isLogin ? 'Sign in' : 'Create account'}
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
                  {isLogin ? 'Create account' : 'Sign in'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#edf1f8',
  },
  app: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#f9fafc',
    shadowColor: '#1e293b',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6f7a90',
    fontSize: 14,
    fontWeight: '600',
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 44,
  },
  brandMark: {
    width: 52,
    height: 52,
    overflow: 'hidden',
    borderRadius: 17,
    marginBottom: 26,
    backgroundColor: '#000000',
  },
  brandMarkImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    color: '#172033',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 9,
  },
  subtitle: {
    color: '#6f7a90',
    fontSize: 15,
    lineHeight: 22,
  },
  form: {
    marginTop: 32,
  },
  label: {
    color: '#34425c',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#dce1ea',
    borderRadius: 13,
    paddingHorizontal: 15,
    marginBottom: 20,
    color: '#172033',
    fontSize: 16,
    backgroundColor: '#ffffff',
  },
  error: {
    color: '#b42318',
    fontSize: 13,
    lineHeight: 19,
    marginTop: -7,
    marginBottom: 14,
  },
  primaryButton: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    marginTop: 4,
    backgroundColor: '#314b9a',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  modePrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 25,
  },
  modePromptText: {
    color: '#6f7a90',
    fontSize: 14,
  },
  modeLink: {
    color: '#405bb6',
    fontSize: 14,
    fontWeight: '700',
  },
});
