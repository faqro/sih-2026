import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
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
  authenticate,
  deleteAccount,
  type AccountType,
  type AuthMode,
} from './src/api/auth';
import DapperScreen from './src/screens/DapperScreen';
import UserMapScreen from './src/screens/UserMapScreen';

type SignedInUser = {
  accountType: AccountType;
  token: string;
  username: string;
};

export default function App() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLogin = mode === 'login';

  async function submit() {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authenticate(mode, username, password);
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

  async function removeAccount() {
    if (!user) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await deleteAccount(user.token);
      setUser(null);
      setMode('login');
      setUsername('');
      setPassword('');
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to delete your account.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user?.accountType === 'user') {
    return (
      <View style={styles.page}>
        <View style={styles.app}>
          <StatusBar style="dark" />
          <UserMapScreen
            error={error}
            isSubmitting={isSubmitting}
            onDeleteAccount={removeAccount}
            onSignOut={() => setUser(null)}
          />
        </View>
      </View>
    );
  }

  if (user) {
    return (
      <View style={styles.page}>
        <SafeAreaView style={styles.app}>
          <StatusBar style="dark" />
          <DapperScreen
            accountError={error}
            isSubmitting={isSubmitting}
            onDeleteAccount={removeAccount}
            onSignOut={() => setUser(null)}
            token={user.token}
            username={user.username}
          />
        </SafeAreaView>
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
                onPress={submit}
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
