import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
  type ImageSourcePropType,
} from 'react-native';

import type { AuthMode } from '../api/auth';

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

export type SocialProvider = 'steam' | 'strava' | 'osu';

type ProviderConfig = {
  id: SocialProvider;
  label: string;
  borderColor: string;
  icon: ImageSourcePropType;
};

const PROVIDERS: readonly ProviderConfig[] = [
  {
    id: 'steam',
    label: 'Continue with Steam',
    borderColor: '#ACB2BE',
    icon: require('../../assets/providers/steam.png'),
  },
  {
    id: 'strava',
    label: 'Continue with Strava',
    borderColor: '#FAC8B8',
    icon: require('../../assets/providers/strava.png'),
  },
  {
    id: 'osu',
    label: 'Continue with OSU',
    borderColor: '#FBD1E4',
    icon: require('../../assets/providers/osu.png'),
  },
];

export const HACKATHON_SUGGESTED_PW = 'Akwab%7(#/"9';

type AuthFlowScreenProps = {
  error: string | null;
  isSubmitting: boolean;
  onCancelProvider?: () => void;
  onClearError: () => void;
  onPressProvider?: (provider: SocialProvider) => void;
  onSubmit: (mode: AuthMode, user: string, pass: string) => void;
  pendingProvider?: SocialProvider | null;
};

export default function AuthFlowScreen({
  error,
  isSubmitting,
  onCancelProvider,
  onClearError,
  onPressProvider,
  onSubmit,
  pendingProvider = null,
}: AuthFlowScreenProps) {
  const isProviderBusy = pendingProvider !== null;
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  // Single master transition progress (0 = Welcome Screen, 1 = Auth Form)
  const transitionProgress = useRef(new Animated.Value(0)).current;

  // Forward transition: Open -> Hands move, touch, slap, clasp -> Form surfaces
  function openAuth(targetMode: AuthMode) {
    setAuthMode(targetMode);
    onClearError();
    setIsAuthOpen(true);

    Animated.timing(transitionProgress, {
      toValue: 1,
      duration: 560,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }

  // Reverse transition: Clasp unlocks -> Hands slide apart to open -> Welcome options surface
  function closeAuth() {
    onClearError();

    Animated.timing(transitionProgress, {
      toValue: 0,
      duration: 520,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsAuthOpen(false);
      }
    });
  }

  function handleFormSubmit() {
    onSubmit(authMode, username, password);
  }

  function handleApplySuggestedPassword() {
    setPassword(HACKATHON_SUGGESTED_PW);
    onClearError();
  }

  // Hand Motion Interpolations:
  // Both hands actively travel inward across the gap, fingertips meet & cross, and palms touch!
  const leftHandTranslateX = transitionProgress.interpolate({
    inputRange: [0, 0.74, 1],
    outputRange: [0, 56, 56],
  });

  const rightHandTranslateX = transitionProgress.interpolate({
    inputRange: [0, 0.74, 1],
    outputRange: [0, -56, -56],
  });

  // Open hands stay 100% visible while traveling and touching;
  // right at the moment of contact (0.74 - 0.82), they snap solidly into the clasped grip
  const openHandsOpacity = transitionProgress.interpolate({
    inputRange: [0, 0.74, 0.82, 1],
    outputRange: [1, 1, 0, 0],
  });

  // Clasped hands snap in at contact point and remain locked
  const closedHandsOpacity = transitionProgress.interpolate({
    inputRange: [0, 0.74, 0.82, 1],
    outputRange: [0, 0, 1, 1],
  });

  // Welcome options layer sinks directly into the white background (NO vertical or horizontal translation!)
  const welcomeOpacity = transitionProgress.interpolate({
    inputRange: [0, 0.42, 1],
    outputRange: [1, 0, 0],
  });
  const welcomeScale = transitionProgress.interpolate({
    inputRange: [0, 0.42, 1],
    outputRange: [1, 0.95, 0.95],
  });

  // Auth form layer surfaces directly from the white background into place (NO vertical or horizontal translation!)
  const authOpacity = transitionProgress.interpolate({
    inputRange: [0, 0.58, 1],
    outputRange: [0, 0, 1],
  });
  const authScale = transitionProgress.interpolate({
    inputRange: [0, 0.58, 1],
    outputRange: [0.95, 0.95, 1],
  });

  // Back button opacity
  const backButtonOpacity = transitionProgress.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [0, 0, 1],
  });

  const isLogin = authMode === 'login';

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header Row */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.welcomeTitle}>Welcome to</Text>
              <Text style={styles.brandTitle}>UberDaps</Text>
            </View>

            {/* Back button (fades in when auth form is active) */}
            <Animated.View
              pointerEvents={isAuthOpen ? 'auto' : 'none'}
              style={[styles.backButtonWrapper, { opacity: backButtonOpacity }]}
            >
              <Pressable
                accessibilityLabel="Go back to welcome options"
                accessibilityRole="button"
                disabled={isSubmitting}
                hitSlop={12}
                onPress={closeAuth}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>← Back</Text>
              </Pressable>
            </Animated.View>
          </View>

          {/* Hand Illustration Area (Hands actually sweep inward, touch, and clasp) */}
          <View style={styles.heroContainer}>
            <View style={styles.handsFrame}>
              {/* OPEN HANDS LAYER (Hands travel from rest across the gap and touch palm-to-palm) */}
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { opacity: openHandsOpacity },
                ]}
              >
                {/* Left Hand with extended forearm anchored to left edge */}
                <Animated.View
                  style={[
                    styles.handFullCanvasWrapper,
                    { transform: [{ translateX: leftHandTranslateX }] },
                  ]}
                >
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={require('../../assets/dap_hand_left_std.png')}
                    style={styles.handImage}
                  />
                </Animated.View>

                {/* Right Hand with extended forearm anchored to right edge */}
                <Animated.View
                  style={[
                    styles.handFullCanvasWrapper,
                    { transform: [{ translateX: rightHandTranslateX }] },
                  ]}
                >
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={require('../../assets/dap_hand_right_std.png')}
                    style={styles.handImage}
                  />
                </Animated.View>
              </Animated.View>

              {/* CLASPED HANDS LAYER (Locked clasp grip replacing touching hands) */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.handFullCanvasWrapper,
                  { opacity: closedHandsOpacity },
                ]}
              >
                <Image
                  accessibilityIgnoresInvertColors
                  resizeMode="contain"
                  source={require('../../assets/dap_hands_clasped_std.png')}
                  style={styles.handImage}
                />
              </Animated.View>
            </View>
          </View>

          {/* Interactive Content Stage (Sinking into white / surfacing from white) */}
          <View style={styles.stageContainer}>
            {/* LAYER 1: WELCOME OPTIONS (Sinks directly into the white background) */}
            <Animated.View
              pointerEvents={isAuthOpen ? 'none' : 'auto'}
              style={[
                styles.layer,
                {
                  opacity: welcomeOpacity,
                  transform: [{ scale: welcomeScale }],
                },
              ]}
            >
              <View style={styles.primaryButtons}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isProviderBusy}
                  onPress={() => openAuth('login')}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && !isProviderBusy && styles.buttonPressed,
                    isProviderBusy && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Log in</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={isProviderBusy}
                  onPress={() => openAuth('signup')}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && !isProviderBusy && styles.buttonPressed,
                    isProviderBusy && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Sign up</Text>
                </Pressable>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {!isAuthOpen && error ? (
                <Text style={styles.welcomeErrorText}>{error}</Text>
              ) : null}

              <View style={styles.providerButtons}>
                {PROVIDERS.map((provider) => {
                  const isPending = pendingProvider === provider.id;

                  return (
                    <Pressable
                      key={provider.id}
                      accessibilityRole="button"
                      disabled={isProviderBusy}
                      onPress={() => onPressProvider?.(provider.id)}
                      style={({ pressed }) => [
                        styles.providerButton,
                        {
                          borderColor: provider.borderColor,
                          shadowColor: provider.borderColor,
                          ...(Platform.OS === 'web'
                            ? ({
                                boxShadow: `0 0 10px 1px ${provider.borderColor}`,
                              } as any)
                            : {}),
                        },
                        pressed && !isProviderBusy && styles.buttonPressed,
                        isProviderBusy && !isPending && styles.buttonDisabled,
                      ]}
                    >
                      <View style={styles.providerButtonInner}>
                        {isPending ? (
                          <ActivityIndicator
                            color="#000000"
                            size="small"
                            style={styles.providerIcon}
                          />
                        ) : (
                          <Image
                            accessibilityIgnoresInvertColors
                            resizeMode="contain"
                            source={provider.icon}
                            style={styles.providerIcon}
                          />
                        )}
                        <Text style={styles.providerButtonText}>
                          {isPending
                            ? `Connecting to ${provider.label.replace('Continue with ', '')}...`
                            : provider.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {pendingProvider && onCancelProvider ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onCancelProvider}
                  style={({ pressed }) => [
                    styles.cancelPendingButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.cancelPendingText}>
                    Cancel {pendingProvider === 'steam'
                      ? 'Steam '
                      : pendingProvider === 'strava'
                        ? 'Strava '
                        : pendingProvider === 'osu'
                          ? 'OSU '
                          : ''}sign-in
                  </Text>
                </Pressable>
              ) : null}
            </Animated.View>

            {/* LAYER 2: AUTH FORM (Surfaces directly from the white background) */}
            <Animated.View
              pointerEvents={isAuthOpen ? 'auto' : 'none'}
              style={[
                styles.layer,
                {
                  opacity: authOpacity,
                  transform: [{ scale: authScale }],
                },
              ]}
            >
              <Text style={styles.authSectionTitle}>
                {isLogin ? 'Log in to UberDaps' : 'Sign up for UberDaps'}
              </Text>

              <View style={styles.form}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect={false}
                  cursorColor="#000000"
                  editable={!isSubmitting}
                  onChangeText={(text) => {
                    setUsername(text);
                    if (error) onClearError();
                  }}
                  placeholderTextColor="#888888"
                  selectionColor="#000000"
                  style={styles.input}
                  value={username}
                />

                <Text style={styles.label}>Password</Text>
                <TextInput
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  cursorColor="#000000"
                  editable={!isSubmitting}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (error) onClearError();
                  }}
                  placeholderTextColor="#888888"
                  secureTextEntry
                  selectionColor="#000000"
                  style={styles.input}
                  value={password}
                />

                {/* Error & Hackathon Easter Egg Prompt */}
                {error ? (
                  <View style={styles.errorBlock}>
                    <Text style={styles.errorText}>{error}</Text>
                    {isLogin && error === 'Incorrect password.' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={handleApplySuggestedPassword}
                        style={styles.suggestedPressable}
                      >
                        <Text style={styles.suggestedText}>
                          Did you mean to enter ‘{HACKATHON_SUGGESTED_PW}’?
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {/* Solid Black Submit Pill */}
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={handleFormSubmit}
                  style={({ pressed }) => [
                    styles.submitButton,
                    pressed && !isSubmitting && styles.buttonPressed,
                    isSubmitting && styles.submitButtonDisabled,
                  ]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {isLogin ? 'Log in' : 'Sign up'}
                    </Text>
                  )}
                </Pressable>
              </View>

              {/* Mode Toggle Link */}
              <View style={styles.modePrompt}>
                <Text style={styles.modePromptText}>
                  {isLogin ? 'New here?' : 'Already have an account?'}
                </Text>
                <Pressable
                  disabled={isSubmitting}
                  onPress={() => {
                    setAuthMode(isLogin ? 'signup' : 'login');
                    onClearError();
                  }}
                >
                  <Text style={styles.modeLink}>
                    {isLogin ? 'Sign up' : 'Log in'}
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  keyboardAvoider: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 22,
    paddingBottom: 36,
    backgroundColor: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    minHeight: 90,
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
  backButtonWrapper: {
    paddingTop: 6,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  backButtonText: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  heroContainer: {
    width: '100%',
    marginTop: 10,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handsFrame: {
    width: '100%',
    aspectRatio: 471 / 195,
    position: 'relative',
    overflow: 'hidden',
  },
  handFullCanvasWrapper: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '-42.46%',
    width: '184.93%',
  },
  handImage: {
    width: '100%',
    height: '100%',
  },
  stageContainer: {
    width: '100%',
    minHeight: 520,
    position: 'relative',
  },
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  primaryButtons: {
    gap: 16,
  },
  primaryButton: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#ececec',
  },
  primaryButtonText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  welcomeErrorText: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 12,
  },
  cancelPendingButton: {
    marginTop: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ececec',
    backgroundColor: '#ffffff',
  },
  cancelPendingText: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#cfcfcf',
  },
  dividerText: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '500',
  },
  providerButtons: {
    gap: 10,
  },
  providerButton: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: '#ececec',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 7,
    elevation: 3,
  },
  providerButtonInner: {
    width: 232,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  providerIcon: {
    width: 26,
    height: 26,
  },
  providerButtonText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  authSectionTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    textAlign: 'center',
    marginBottom: 24,
  },
  form: {
    width: '100%',
  },
  label: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
    paddingLeft: 2,
  },
  input: {
    height: 58,
    borderRadius: 10,
    paddingHorizontal: 16,
    marginBottom: 18,
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    backgroundColor: '#ececec',
  },
  errorBlock: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  errorText: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  suggestedPressable: {
    paddingVertical: 2,
  },
  suggestedText: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  submitButton: {
    alignSelf: 'center',
    width: 180,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginTop: 10,
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  modePrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 24,
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
