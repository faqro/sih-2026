import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { AppMode } from '../api/auth';

export type OnboardingAction = AppMode | 'skip';

type ModeCardConfig = {
  mode: AppMode;
  title: string;
  description: string;
};

const MODE_CARDS: readonly ModeCardConfig[] = [
  {
    mode: 'dapper',
    title: 'Become a Dapper',
    description: 'Go on the map to pick up and fulfill nearby dap requests.',
  },
  {
    mode: 'order',
    title: 'Order a Dap',
    description: 'Use the map to find nearby dappers and order a dap.',
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
        <View style={styles.topRow}>
          <View style={styles.brandMark}>
            <Image
              accessibilityLabel="Uber DAPS logo"
              resizeMode="cover"
              source={require('../../assets/uberdaps-logo.jpg')}
              style={styles.brandMarkImage}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            hitSlop={8}
            onPress={onSignOut}
          >
            <Text style={[styles.signOutLink, isSubmitting && styles.dimmed]}>
              Sign out
            </Text>
          </Pressable>
        </View>

        <Text style={styles.title}>Choose where to start</Text>
        <Text style={styles.subtitle}>
          Pick a cue card below or skip for now. You can switch anytime later.
        </Text>

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
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  {isPending ? (
                    <ActivityIndicator color="#314b9a" size="small" />
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

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={onSkip}
            style={[styles.skipButton, isSubmitting && styles.dimmed]}
          >
            {pendingAction === 'skip' ? (
              <ActivityIndicator color="#405bb6" size="small" />
            ) : (
              <Text style={styles.skipButtonText}>Skip</Text>
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
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 28,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  brandMark: {
    width: 52,
    height: 52,
    overflow: 'hidden',
    borderRadius: 17,
    backgroundColor: '#000000',
  },
  brandMarkImage: {
    width: '100%',
    height: '100%',
  },
  signOutLink: {
    color: '#6f7a90',
    fontSize: 14,
    fontWeight: '600',
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
  cardsStack: {
    gap: 14,
    marginTop: 28,
  },
  cueCard: {
    minHeight: 132,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dce1ea',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 22,
    backgroundColor: '#ffffff',
    shadowColor: '#1e293b',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cueCardPressed: {
    borderColor: '#314b9a',
    backgroundColor: '#f8faff',
  },
  dimmed: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitle: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  cardArrow: {
    color: '#405bb6',
    fontSize: 18,
    fontWeight: '700',
  },
  cardDescription: {
    color: '#6f7a90',
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: '#b42318',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    marginTop: 20,
  },
  skipButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#cbd3e3',
    borderRadius: 13,
    backgroundColor: 'transparent',
  },
  skipButtonText: {
    color: '#405bb6',
    fontSize: 15,
    fontWeight: '700',
  },
});
