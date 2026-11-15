import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { AppMode } from '../api/auth';
import {
  resolveDapperOnlineLocation,
  resolveWebDapperOnlineLocation,
  type Coordinates,
  type DapperLocationFailureReason,
} from '../location/dapperLocation';
import { useDapperLocationStream } from '../hooks/useDapperLocationStream';
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
  token: string;
};

type LocationPromptState = {
  reason: DapperLocationFailureReason;
  canOpenSettings: boolean;
  message: string;
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
  token,
}: MapScreenProps) {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [isDapperOnline, setIsDapperOnline] = useState(false);
  const [isGoingOnline, setIsGoingOnline] = useState(false);
  const [locationPrompt, setLocationPrompt] =
    useState<LocationPromptState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false);
  const [selectedDap, setSelectedDap] = useState<DapOption>('UberDap');
  const [matchDeadline, setMatchDeadline] = useState<number | null>(null);
  const [matchSecondsRemaining, setMatchSecondsRemaining] = useState(600);
  const [showMatchToast, setShowMatchToast] = useState(false);
  const { height: viewportHeight } = useWindowDimensions();
  const sheetHeight = viewportHeight / 2;
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const matchExpiredRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  const isMountedRef = useRef(true);
  const activeModeRef = useRef(activeMode);
  activeModeRef.current = activeMode;
  const goOnlineRequestIdRef = useRef(0);
  const {
    connectionError,
    goOffline,
    goOnline,
    isConnecting,
  } = useDapperLocationStream(token, activeMode === 'dapper');

  function resetDapperLocationState() {
    goOnlineRequestIdRef.current += 1;
    setIsDapperOnline(false);
    setIsGoingOnline(false);
    setLocation(null);
    setLocationPrompt(null);
    goOffline();
  }

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      goOnlineRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    activeModeRef.current = activeMode;

    if (activeMode !== 'dapper') {
      goOnlineRequestIdRef.current += 1;
      setIsDapperOnline(false);
      setIsGoingOnline(false);
      setLocation(null);
      setLocationPrompt(null);
    }

    if (activeMode !== 'order') {
      sheetProgress.stopAnimation();
      sheetProgress.setValue(0);
      setIsRequestMenuOpen(false);
    }
  }, [activeMode, sheetProgress]);

  function handleSelectMode(nextMode: AppMode) {
    setIsMenuOpen(false);

    if (nextMode === activeMode) {
      return;
    }

    if (nextMode !== 'dapper') {
      resetDapperLocationState();
    }

    if (nextMode !== 'order') {
      sheetProgress.stopAnimation();
      sheetProgress.setValue(0);
      setIsRequestMenuOpen(false);
    }

    onChangeMode(nextMode);
  }

  async function handleGoOnline() {
    if (
      isSubmitting ||
      activeModeRef.current !== 'dapper' ||
      isDapperOnline ||
      isGoingOnline
    ) {
      return;
    }

    const requestId = ++goOnlineRequestIdRef.current;
    const isCurrentAttempt = () =>
      isMountedRef.current &&
      activeModeRef.current === 'dapper' &&
      goOnlineRequestIdRef.current === requestId;

    setIsMenuOpen(false);
    setLocationPrompt(null);
    setIsGoingOnline(true);

    const result =
      Platform.OS === 'web'
        ? await resolveWebDapperOnlineLocation()
        : await resolveDapperOnlineLocation(
            {
              hasServicesEnabledAsync: () => Location.hasServicesEnabledAsync(),
              getForegroundPermissionsAsync: () =>
                Location.getForegroundPermissionsAsync(),
              requestForegroundPermissionsAsync: () =>
                Location.requestForegroundPermissionsAsync(),
              getCurrentPositionAsync: () =>
                Location.getCurrentPositionAsync({
                  accuracy: Location.Accuracy.Balanced,
                }),
            },
            { isNative: true },
          );

    if (!isCurrentAttempt()) {
      return;
    }

    setIsGoingOnline(false);

    if (!result.ok) {
      setIsDapperOnline(false);
      setLocation(null);
      setLocationPrompt({
        reason: result.reason,
        canOpenSettings: result.canOpenSettings,
        message: result.message,
      });
      return;
    }

    setLocation(result.coordinates);
    setIsDapperOnline(true);
    setLocationPrompt(null);
    void goOnline();
  }

  function handleGoOffline() {
    setIsMenuOpen(false);
    resetDapperLocationState();
  }

  function cancelGoOnline() {
    setIsMenuOpen(false);
    resetDapperLocationState();
  }

  function dismissLocationPrompt() {
    setIsMenuOpen(false);
    setLocationPrompt(null);
  }

  async function handleOpenSettings() {
    if (Platform.OS === 'web') {
      return;
    }

    setIsMenuOpen(false);

    try {
      await Linking.openSettings();
    } catch {
      setLocationPrompt((current) =>
        current
          ? {
              ...current,
              canOpenSettings: false,
              message:
                'Unable to open device settings automatically. Open your device settings, allow location access for this app, and tap Try again.',
            }
          : current,
      );
    }
  }

  function handleSignOut() {
    setIsMenuOpen(false);
    resetDapperLocationState();
    onSignOut();
  }

  function handleDeleteAccount() {
    setIsMenuOpen(false);
    resetDapperLocationState();
    onDeleteAccount();
  }

  useEffect(() => {
    if (matchDeadline === null) {
      return;
    }

    const updateCountdown = () => {
      const secondsRemaining = Math.max(
        0,
        Math.ceil((matchDeadline - Date.now()) / 1000),
      );
      setMatchSecondsRemaining(secondsRemaining);

      if (secondsRemaining === 0 && !matchExpiredRef.current) {
        matchExpiredRef.current = true;
        setMatchDeadline(null);
        setShowMatchToast(true);
        toastTimeoutRef.current = setTimeout(() => {
          setShowMatchToast(false);
          toastTimeoutRef.current = null;
        }, 3000);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [matchDeadline]);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    },
    [],
  );

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
    setMatchDeadline(null);
    setMatchSecondsRemaining(600);
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

  const isDapperMode = activeMode === 'dapper';
  const displayedLocation =
    isDapperMode && isDapperOnline ? location : null;

  function confirmRequest() {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    setShowMatchToast(false);
    matchExpiredRef.current = false;
    setMatchSecondsRemaining(600);
    setMatchDeadline(Date.now() + 10 * 60 * 1000);
  }

  const matchMinutesRemaining = Math.ceil(matchSecondsRemaining / 60);
  const formattedMinutes = Math.floor(matchSecondsRemaining / 60);
  const formattedSeconds = String(matchSecondsRemaining % 60).padStart(2, '0');
  const formattedSecondsRemaining = `${formattedMinutes}:${formattedSeconds}`;

  return (
    <View style={styles.container}>
      <View style={styles.mapLayer}>
        <MapSurface location={displayedLocation} mode={activeMode} />
      </View>

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.bottomActions}>
          {isDapperMode && connectionError ? (
            <View style={styles.onlineBadge}>
              <Text style={styles.accountError}>{connectionError}</Text>
            </View>
          ) : null}

          {isDapperMode && isDapperOnline ? (
            <View style={styles.onlineBadge}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineBadgeText}>
                You are online as a Dapper
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || (isDapperMode && isGoingOnline)}
            onPress={() => {
              if (isDapperMode) {
                if (isDapperOnline) {
                  handleGoOffline();
                } else {
                  void handleGoOnline();
                }
              } else {
                openRequestMenu();
              }
            }}
            style={[
              styles.requestButton,
              isDapperMode && isDapperOnline && styles.offlineButton,
              (isSubmitting || (isDapperMode && isGoingOnline)) &&
                styles.disabledButton,
            ]}
          >
            <Text style={styles.requestButtonText}>
              {isDapperMode
                ? isDapperOnline
                  ? 'Go Offline'
                  : 'Go Online'
                : 'Request UberDap'}
            </Text>
          </Pressable>
        </View>

        {isDapperMode && (isGoingOnline || locationPrompt) ? (
          <View style={styles.promptOverlay}>
            <View style={styles.promptCard}>
              {isGoingOnline ? (
                <>
                  <ActivityIndicator color="#314b9a" size="small" />
                  <Text style={styles.promptTitle}>Checking location</Text>
                  <Text style={styles.promptMessage}>
                    Location must be enabled to go online as a Dapper.
                  </Text>
                  <View style={styles.promptActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={cancelGoOnline}
                      style={styles.cancelButton}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              ) : locationPrompt ? (
                <>
                  <Text style={styles.promptTitle}>
                    Location required to go online
                  </Text>
                  <Text style={styles.promptMessage}>
                    {locationPrompt.message}
                  </Text>
                  <View style={styles.promptActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void handleGoOnline()}
                      style={styles.retryButton}
                    >
                      <Text style={styles.retryButtonText}>Try again</Text>
                    </Pressable>
                    {locationPrompt.canOpenSettings ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void handleOpenSettings()}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>
                          Open settings
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={dismissLocationPrompt}
                      style={styles.cancelButton}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        ) : null}


        <View pointerEvents="box-none" style={styles.topBar}>
          <View style={styles.modeToggleCard}>
            {MODE_TABS.map((tab) => {
              const isSelected = activeMode === tab.mode;

              return (
                <Pressable
                  key={tab.mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  disabled={isSubmitting}
                  onPress={() => handleSelectMode(tab.mode)}
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
                  onPress={handleSignOut}
                  style={styles.menuItem}
                >
                  <Text style={styles.signOutText}>Sign out</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={handleDeleteAccount}
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
              <Text style={styles.sheetTitle}>
                {matchDeadline === null
                  ? 'Choose your UberDap'
                  : 'Finding a dapper'}
              </Text>
              <Pressable
                accessibilityLabel="Close request menu"
                accessibilityRole="button"
                onPress={closeRequestMenu}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseText}>
                  {matchDeadline === null ? 'Close' : 'Cancel'}
                </Text>
              </Pressable>
            </View>
            {matchDeadline === null ? (
              <>
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
                <Pressable
                  accessibilityRole="button"
                  onPress={confirmRequest}
                  style={styles.confirmButton}
                >
                  <Text style={styles.confirmButtonText}>
                    Confirm UberDap
                  </Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.matchingContent}>
                <ActivityIndicator color="#314b9a" size="large" />
                <Text style={styles.matchingText}>
                  Matching you with a dapper within the next{' '}
                  {matchMinutesRemaining}{' '}
                  {matchMinutesRemaining === 1 ? 'minute' : 'minutes'}...
                </Text>
                <Text style={styles.matchingCountdown}>
                  {formattedSecondsRemaining} remaining
                </Text>
              </View>
            )}
          </Animated.View>
        ) : null}

        {showMatchToast ? (
          <View pointerEvents="none" style={styles.toast}>
            <Text style={styles.toastText}>
              We couldn't match you with a dapper. Try again later.
            </Text>
          </View>
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
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1100,
    elevation: 10,
  },
  promptOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1101,
    elevation: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 24,
    backgroundColor: 'rgba(23, 32, 51, 0.3)',
  },
  promptCard: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 22,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  promptTitle: {
    color: '#172033',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  promptMessage: {
    color: '#34425c',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  promptActions: {
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  retryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: '#314b9a',
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#314b9a',
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#314b9a',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dce1ea',
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
  },
  cancelButtonText: {
    color: '#34425c',
    fontSize: 14,
    fontWeight: '600',
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
    zIndex: 1100,
    gap: 10,
  },
  onlineBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#172033',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#16a34a',
  },
  onlineBadgeText: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '700',
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
  offlineButton: {
    backgroundColor: '#172033',
  },
  requestButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  dapperStatus: {
    borderRadius: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#34425c',
    fontSize: 13,
    textAlign: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  goOnlineButton: {
    backgroundColor: '#16845b',
  },
  goOfflineButton: {
    backgroundColor: '#b42318',
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
  confirmButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    marginTop: 16,
    backgroundColor: '#314b9a',
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  matchingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  matchingText: {
    color: '#34425c',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 18,
    textAlign: 'center',
  },
  matchingCountdown: {
    color: '#6f7a90',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  toast: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 1105,
    elevation: 16,
    maxWidth: '90%',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: '#172033',
    shadowColor: '#172033',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
