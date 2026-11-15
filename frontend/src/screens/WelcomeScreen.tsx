import { useRef } from 'react';
import {
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

export type SocialProvider = 'steam' | 'strava' | 'spotify' | 'osu' | 'chess';

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
  {
    id: 'chess',
    label: 'Continue with Chess.com',
    borderColor: '#D7E8C7',
    icon: require('../../assets/providers/chess.png'),
  },
];

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

type WelcomeScreenProps = {
  onPressLogin: () => void;
  onPressProvider?: (provider: SocialProvider) => void;
  onPressSignup: () => void;
};

export default function WelcomeScreen({
  onPressLogin,
  onPressProvider,
  onPressSignup,
}: WelcomeScreenProps) {
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
              onPress={() => handleTriggerAndProceed(onPressLogin)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Log in</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => handleTriggerAndProceed(onPressSignup)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
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

          <View style={styles.providerButtons}>
            {PROVIDERS.map((provider) => (
              <Pressable
                key={provider.id}
                accessibilityRole="button"
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
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={styles.providerButtonInner}>
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={provider.icon}
                    style={styles.providerIcon}
                  />
                  <Text style={styles.providerButtonText}>{provider.label}</Text>
                </View>
              </Pressable>
            ))}
          </View>
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
});
