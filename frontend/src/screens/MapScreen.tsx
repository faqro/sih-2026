import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { AppMode } from '../api/auth';
import MapSurface from './MapSurface';

const dapOptions = ['UberDap', 'UberDap Plus', 'UberDap Deluxe'] as const;
type DapOption = (typeof dapOptions)[number];

type MapScreenProps = {
  activeMode: AppMode;
  error: string | null;
  isSubmitting: boolean;
  onChangeMode: (nextMode: AppMode) => void;
  onDeleteAccount: () => void;
  onSignOut: () => void;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

const MODE_TABS: readonly { mode: AppMode; label: string }[] = [
  { mode: 'order', label: 'Order a Dap' },
  { mode: 'dapper', label: 'Dapper' },
];

export default function MapScreen({
  activeMode,
  error,
  isSubmitting,
  onChangeMode,
  onDeleteAccount,
  onSignOut,
}: MapScreenProps) {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false);
  const [selectedDap, setSelectedDap] = useState<DapOption>('UberDap');
  const { height: viewportHeight } = useWindowDimensions();
  const sheetHeight = viewportHeight / 2;
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });

  useEffect(() => {
    let isActive = true;

    async function locateUser() {
      setIsLocating(true);
      setLocationError(null);

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== 'granted') {
          if (isActive) {
            setLocationError(
              'Location access is needed to show your map. Enable it in your device settings and try again.',
            );
          }
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (isActive) {
          setLocation({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
          });
        }
      } catch {
        if (isActive) {
          setLocationError(
            'Unable to get your location. Check that location services are enabled and try again.',
          );
        }
      } finally {
        if (isActive) {
          setIsLocating(false);
        }
      }
    }

    void locateUser();

    return () => {
      isActive = false;
    };
  }, [attempt]);

  function openRequestMenu() {
    setIsMenuOpen(false);
    setIsRequestMenuOpen(true);
    sheetProgress.setValue(0);
    Animated.timing(sheetProgress, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }

  function closeRequestMenu() {
    Animated.timing(sheetProgress, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsRequestMenuOpen(false);
      }
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapLayer}>
        {location ? (
          <MapSurface location={location} mode={activeMode} />
        ) : (
          <View style={styles.mapPlaceholder} />
        )}
      </View>

      {isLocating ? (
        <View style={styles.locationMessage}>
          <ActivityIndicator color="#314b9a" />
          <Text style={styles.messageText}>Finding your location...</Text>
        </View>
      ) : null}

      {locationError ? (
        <View style={styles.locationMessage}>
          <Text style={styles.messageText}>{locationError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((current) => current + 1)}
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View pointerEvents="box-none" style={styles.topBar}>
          <View style={styles.modeToggleCard}>
            {MODE_TABS.map((tab) => {
              const isSelected = activeMode === tab.mode;

              return (
                <Pressable
                  key={tab.mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onChangeMode(tab.mode)}
                  style={[
                    styles.modeTab,
                    isSelected && styles.modeTabSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      isSelected && styles.modeTabTextSelected,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.topRight}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isMenuOpen ? 'Close account menu' : 'Open account menu'
              }
              accessibilityState={{ expanded: isMenuOpen }}
              disabled={isSubmitting}
              onPress={() => setIsMenuOpen((isOpen) => !isOpen)}
              style={[styles.menuButton, isSubmitting && styles.disabledButton]}
            >
              <View style={styles.hamburgerIcon}>
                <View style={styles.hamburgerLine} />
                <View style={styles.hamburgerLine} />
                <View style={styles.hamburgerLine} />
              </View>
            </Pressable>
            {isMenuOpen ? (
              <View style={styles.menu}>
                {error ? <Text style={styles.accountError}>{error}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={onSignOut}
                  style={styles.menuItem}
                >
                  <Text style={styles.signOutText}>Sign out</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={onDeleteAccount}
                  style={[styles.menuItem, styles.deleteButton]}
                >
                  <Text style={styles.deleteText}>
                    {isSubmitting ? 'Deleting account...' : 'Delete account'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.bottomActions}>
          <Pressable
            accessibilityRole="button"
            onPress={activeMode === 'order' ? openRequestMenu : undefined}
            style={styles.requestButton}
          >
            <Text style={styles.requestButtonText}>
              {activeMode === 'dapper' ? 'Go Online' : 'Request UberDap'}
            </Text>
          </Pressable>
        </View>

        {isRequestMenuOpen ? (
          <Animated.View
            style={[
              styles.requestSheet,
              {
                height: sheetHeight,
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Choose your UberDap</Text>
              <Pressable
                accessibilityLabel="Close request menu"
                accessibilityRole="button"
                onPress={closeRequestMenu}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.options}>
              {dapOptions.map((option) => {
                const isSelected = selectedDap === option;

                return (
                  <Pressable
                    accessibilityLabel={option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    key={option}
                    onPress={() => setSelectedDap(option)}
                    style={[
                      styles.optionButton,
                      isSelected && styles.optionButtonSelected,
                    ]}
                  >
                    <View
                      style={[
                        styles.radio,
                        isSelected && styles.radioSelected,
                      ]}
                    >
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: '#e8edf5',
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  mapPlaceholder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#e8edf5',
  },
  locationMessage: {
    position: 'absolute',
    top: '42%',
    zIndex: 1200,
    alignSelf: 'center',
    maxWidth: '85%',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    padding: 18,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  messageText: {
    color: '#34425c',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#314b9a',
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1100,
    elevation: 10,
  },
  topBar: {
    position: 'absolute',
    top: 16,
    right: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 1102,
    elevation: 12,
  },
  modeToggleCard: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    borderRadius: 16,
    padding: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#172033',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  modeTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  modeTabSelected: {
    backgroundColor: '#314b9a',
  },
  modeTabText: {
    color: '#6f7a90',
    fontSize: 14,
    fontWeight: '700',
  },
  modeTabTextSelected: {
    color: '#ffffff',
  },
  topRight: {
    alignItems: 'flex-end',
  },
  menuButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  hamburgerIcon: {
    gap: 4,
  },
  hamburgerLine: {
    width: 19,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#172033',
  },
  menu: {
    position: 'absolute',
    top: 60,
    right: 0,
    width: 200,
    borderRadius: 14,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  menuItem: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  bottomActions: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    left: 16,
  },
  requestButton: {
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#314b9a',
    shadowColor: '#172033',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  requestButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  accountError: {
    color: '#b42318',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  signOutText: {
    color: '#405bb6',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteButton: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e9f0',
  },
  deleteText: {
    color: '#b42318',
    fontSize: 14,
    fontWeight: '700',
  },
  requestSheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1103,
    elevation: 14,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  sheetTitle: {
    color: '#172033',
    fontSize: 19,
    fontWeight: '700',
  },
  sheetCloseButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sheetCloseText: {
    color: '#526cc2',
    fontSize: 14,
    fontWeight: '700',
  },
  options: {
    gap: 12,
  },
  optionButton: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dce1ea',
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
  },
  optionButtonSelected: {
    borderColor: '#314b9a',
    backgroundColor: '#f3f5fc',
  },
  radio: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#aab3c3',
    borderRadius: 11,
    marginRight: 13,
  },
  radioSelected: {
    borderColor: '#314b9a',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#314b9a',
  },
  optionText: {
    color: '#34425c',
    fontSize: 15,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: '#314b9a',
  },
});
