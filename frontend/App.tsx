import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ApiError,
  authenticate,
  completeOnboarding,
  deleteAccount,
  fetchCurrentUser,
  updateDapperPreferences,
  updateActiveMode,
  type AppMode,
  type AuthMode,
  type AuthUser,
  type DapService,
  type OnboardingChoice,
} from './src/api/auth';
import AuthFlowScreen from './src/screens/AuthFlowScreen';
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
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [onboardingAction, setOnboardingAction] =
    useState<OnboardingAction | null>(null);
  const modeChangeInProgressRef = useRef(false);

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
            error={error}
            isChangingMode={isChangingMode}
            isSavingPreferences={isSavingPreferences}
            isSubmitting={isSubmitting}
            offeredServices={user.offeredServices}
            onChangeMode={(nextMode) => void handleChangeMapMode(nextMode)}
            onDeleteAccount={() => void removeAccount()}
            onSaveDapperPreferences={handleSaveDapperPreferences}
            onSignOut={() => signOut()}
            token={user.token}
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
          onClearError={() => setError(null)}
          onSubmit={(nextMode, nextUser, nextPass) => {
            setMode(nextMode);
            setUsername(nextUser);
            setPassword(nextPass);
            void submit(nextMode, nextUser, nextPass);
          }}
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
