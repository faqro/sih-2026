import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { AppMode } from '../api/auth';

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

export type OnboardingAction = AppMode | 'skip';

type ModeCardConfig = {
  mode: AppMode;
  badge: string;
  title: string;
  description: string;
};

const MODE_CARDS: readonly ModeCardConfig[] = [
  {
    mode: 'order',
    badge: 'PASSENGER',
    title: 'Order a Dap',
    description: 'Call a dapper to your exact location for a high-resonance dap on demand.',
  },
  {
    mode: 'dapper',
    badge: 'DRIVER / FULFILLER',
    title: 'Become a Dapper',
    description: 'Hit the streets, receive live nearby requests, and deliver immaculate dap ups.',
  },
];

type OnboardingModeScreenProps = {
  error: string | null;
  pendingAction: OnboardingAction | null;
  onSelectMode: (mode: AppMode) => void;
  onSignOut: () => void;
  onSkip: () => void;
};

export default function OnboardingModeScreen({
  error,
  pendingAction,
  onSelectMode,
  onSignOut,
  onSkip,
}: OnboardingModeScreenProps) {
  const isSubmitting = pendingAction !== null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {/* Top Header */}
        <View style={styles.topRow}>
          <Text style={styles.brandTitle}>UberDaps</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            hitSlop={10}
            onPress={onSignOut}
          >
            <Text style={[styles.signOutLink, isSubmitting && styles.dimmed]}>
              Sign out
            </Text>
          </Pressable>
        </View>

        <Text style={styles.title}>Choose your role</Text>
        <Text style={styles.subtitle}>
          Select your primary mode to get started on the streets. You can switch anytime.
        </Text>

        {/* Mode cards */}
        <View style={styles.cardsStack}>
          {MODE_CARDS.map((card) => {
            const isPending = pendingAction === card.mode;

            return (
              <Pressable
                key={card.mode}
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => onSelectMode(card.mode)}
                style={({ pressed }) => [
                  styles.cueCard,
                  pressed && !isSubmitting && styles.cueCardPressed,
                  isSubmitting && !isPending && styles.dimmed,
                ]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardBadge}>{card.badge}</Text>
                    <Text style={styles.cardTitle}>{card.title}</Text>
                  </View>
                  {isPending ? (
                    <ActivityIndicator color="#000000" size="small" />
                  ) : (
                    <Text style={styles.cardArrow}>→</Text>
                  )}
                </View>
                <Text style={styles.cardDescription}>{card.description}</Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={onSkip}
            style={({ pressed }) => [
              styles.skipButton,
              pressed && styles.buttonPressed,
              isSubmitting && styles.dimmed,
            ]}
          >
            {pendingAction === 'skip' ? (
              <ActivityIndicator color="#000000" size="small" />
            ) : (
              <Text style={styles.skipButtonText}>Skip for now</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    backgroundColor: '#ffffff',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  brandTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  signOutLink: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  subtitle: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  cardsStack: {
    gap: 16,
    marginTop: 32,
  },
  cueCard: {
    minHeight: 130,
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#ececec',
  },
  cueCardPressed: {
    backgroundColor: '#e2e2e2',
    transform: [{ scale: 0.99 }],
  },
  dimmed: {
    opacity: 0.5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleRow: {
    gap: 4,
  },
  cardBadge: {
    color: '#777777',
    fontFamily: displayFontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  cardTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  cardArrow: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 22,
    fontWeight: '700',
  },
  cardDescription: {
    color: '#444444',
    fontFamily: displayFontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    marginTop: 28,
  },
  skipButton: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#000000',
    backgroundColor: 'transparent',
  },
  buttonPressed: {
    backgroundColor: '#ececec',
  },
  skipButtonText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
});
