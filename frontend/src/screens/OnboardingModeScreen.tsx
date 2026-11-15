import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useState } from 'react';

import type { AppMode, DapService } from '../api/auth';

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

const DAPPER_SERVICES: readonly DapService[] = [
  'UberDap',
  'UberDap Plus',
  'UberDap Deluxe',
];

type OnboardingModeScreenProps = {
  error: string | null;
  pendingAction: OnboardingAction | null;
  onSelectMode: (mode: AppMode, offeredServices: DapService[]) => void;
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
  const [isChoosingServices, setIsChoosingServices] = useState(false);
  const [offeredServices, setOfferedServices] = useState<DapService[]>([]);
  const isSubmitting = pendingAction !== null;

  function chooseMode(mode: AppMode) {
    if (mode === 'dapper') {
      setIsChoosingServices(true);
      return;
    }

    onSelectMode('order', []);
  }

  function toggleService(service: DapService) {
    setOfferedServices((current) =>
      current.includes(service)
        ? current.filter((item) => item !== service)
        : [...current, service],
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.brandTitle}>UberDaps</Text>
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

        <Text style={styles.title}>
          {isChoosingServices ? 'Choose your dapper services' : 'Choose where to start'}
        </Text>
        <Text style={styles.subtitle}>
          {isChoosingServices
            ? 'Select at least one service you want to offer. You can change this anytime.'
            : 'Pick a cue card below or skip for now. You can switch anytime later.'}
        </Text>

        {isChoosingServices ? (
          <View style={styles.cardsStack}>
            {DAPPER_SERVICES.map((service) => {
              const isSelected = offeredServices.includes(service);

              return (
                <Pressable
                  key={service}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  disabled={isSubmitting}
                  onPress={() => toggleService(service)}
                  style={[
                    styles.serviceCard,
                    isSelected && styles.serviceCardSelected,
                    isSubmitting && styles.dimmed,
                  ]}
                >
                  <View
                    style={[
                      styles.serviceCheckbox,
                      isSelected && styles.serviceCheckboxSelected,
                    ]}
                  >
                    {isSelected ? (
                      <View style={styles.serviceCheckmark} />
                    ) : null}
                  </View>
                  <Text style={styles.cardTitle}>{service}</Text>
                </Pressable>
              );
            })}
            <View style={styles.serviceActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => setIsChoosingServices(false)}
                style={[styles.backButton, isSubmitting && styles.dimmed]}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting || offeredServices.length === 0}
                onPress={() => onSelectMode('dapper', offeredServices)}
                style={[
                  styles.continueButton,
                  (isSubmitting || offeredServices.length === 0) && styles.dimmed,
                ]}
              >
                {pendingAction === 'dapper' ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.continueButtonText}>
                    Continue as Dapper
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.cardsStack}>
            {MODE_CARDS.map((card) => {
              const isPending = pendingAction === card.mode;

              return (
                <Pressable
                  key={card.mode}
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={() => chooseMode(card.mode)}
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
        )}

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
  brandTitle: {
    color: '#000000',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.6,
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
  serviceCard: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dce1ea',
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
  },
  serviceCardSelected: {
    borderColor: '#314b9a',
    backgroundColor: '#f3f5fc',
  },
  serviceCheckbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#aab3c3',
    borderRadius: 6,
    marginRight: 14,
  },
  serviceCheckboxSelected: {
    borderColor: '#314b9a',
    backgroundColor: '#314b9a',
  },
  serviceCheckmark: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
  serviceActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  backButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#cbd3e3',
    borderRadius: 13,
    paddingHorizontal: 18,
  },
  backButtonText: {
    color: '#405bb6',
    fontSize: 14,
    fontWeight: '700',
  },
  continueButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    paddingHorizontal: 12,
    backgroundColor: '#314b9a',
  },
  continueButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
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
