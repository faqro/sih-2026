import { useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import AnimatedDapHands, {
  type AnimatedDapHandsHandle,
} from '../components/AnimatedDapHands';

export type SocialProvider = 'steam' | 'strava' | 'spotify' | 'osu';

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
    id: 'spotify',
    label: 'Continue with Spotify',
    borderColor: '#B3EEC9',
    icon: require('../../assets/providers/spotify.png'),
  },
  {
    id: 'osu',
    label: 'Continue with OSU',
    borderColor: '#FBD1E4',
    icon: require('../../assets/providers/osu.png'),
  },
];

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

type WelcomeScreenProps = {
  error?: string | null;
  onCancelProvider?: () => void;
  onPressLogin: () => void;
  onPressProvider?: (provider: SocialProvider) => void;
  onPressSignup: () => void;
  pendingProvider?: SocialProvider | null;
};

export default function WelcomeScreen({
  error = null,
  onCancelProvider,
  onPressLogin,
  onPressProvider,
  onPressSignup,
  pendingProvider = null,
}: WelcomeScreenProps) {
  const isBusy = pendingProvider !== null;
  const dapHandsRef = useRef<AnimatedDapHandsHandle>(null);

  function handleTriggerAndProceed(callback: () => void) {
    void dapHandsRef.current?.triggerDap();
    setTimeout(() => {
      callback();
    }, 280);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.welcomeTitle}>Welcome to</Text>
          <Text style={styles.brandTitle}>UberDaps</Text>
        </View>

        <View style={styles.heroContainer}>
          <AnimatedDapHands ref={dapHandsRef} />
        </View>

        <View style={styles.actionsSection}>
          <View style={styles.primaryButtons}>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={() => handleTriggerAndProceed(onPressLogin)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !isBusy && styles.buttonPressed,
                isBusy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonText}>Log in</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={() => handleTriggerAndProceed(onPressSignup)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !isBusy && styles.buttonPressed,
                isBusy && styles.buttonDisabled,
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

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.providerButtons}>
            {PROVIDERS.map((provider) => {
              const isPending = pendingProvider === provider.id;

              return (
                <Pressable
                  key={provider.id}
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() =>
                    handleTriggerAndProceed(() => onPressProvider?.(provider.id))
                  }
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
                    pressed && !isBusy && styles.buttonPressed,
                    isBusy && !isPending && styles.buttonDisabled,
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
                        ? 'Connecting to Steam...'
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
                Cancel {pendingProvider === 'steam' ? 'Steam ' : ''}sign-in
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingTop: 22,
    paddingBottom: 28,
    backgroundColor: '#ffffff',
  },
  header: {
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
  heroContainer: {
    width: '100%',
    marginTop: 10,
    marginBottom: 14,
  },
  heroImage: {
    width: '100%',
    height: undefined,
    aspectRatio: 471 / 149,
  },
  actionsSection: {
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
  errorText: {
    color: '#e53935',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 12,
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
  cancelPendingButton: {
    marginTop: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d0d7e2',
    backgroundColor: '#ffffff',
  },
  cancelPendingText: {
    color: '#34425c',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
});
