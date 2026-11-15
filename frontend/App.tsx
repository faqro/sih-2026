import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authenticate, type AuthMode } from './src/api/auth';

type SignedInUser = {
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
      setUser(result.user);
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

  if (user) {
    return (
      <View style={styles.page}>
        <SafeAreaView style={styles.app}>
          <StatusBar style="dark" />
          <View style={styles.signedInContent}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user.username.charAt(0)}</Text>
            </View>
            <Text style={styles.eyebrow}>SIGNED IN</Text>
            <Text style={styles.welcomeTitle}>Welcome, {user.username}</Text>
            <Text style={styles.welcomeDescription}>
              Your account is ready to use.
            </Text>
            <Pressable
              onPress={() => setUser(null)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
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
              <Text style={styles.brandMarkText}>S</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    marginBottom: 26,
    backgroundColor: '#314b9a',
  },
  brandMarkText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
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
  signedInContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  avatar: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 38,
    marginBottom: 23,
    backgroundColor: '#dfe7ff',
  },
  avatarText: {
    color: '#314b9a',
    fontSize: 32,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  eyebrow: {
    color: '#526cc2',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  welcomeTitle: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  welcomeDescription: {
    color: '#6f7a90',
    fontSize: 15,
    marginBottom: 27,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#cbd3e3',
    borderRadius: 13,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: '#405bb6',
    fontSize: 14,
    fontWeight: '700',
  },
});
