import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import DapMinigame from './DapMinigame';

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

const DAP_OPTIONS = [
  {
    id: 'UberDap',
    title: 'UberDap',
    tag: 'CLASSIC',
    time: '2 min',
    description: 'Crisp single-contact street snap.',
    glowColor: '#B3EEC9',
  },
  {
    id: 'UberDap Plus',
    title: 'UberDap Plus',
    tag: 'POPULAR',
    time: '3 min',
    description: 'Two-handed grip, slide & shoulder tap.',
    glowColor: '#FAC8B8',
  },
  {
    id: 'UberDap Deluxe',
    title: 'UberDap Deluxe',
    tag: 'VIP PROTOCOL',
    time: '5 min',
    description: '5-step synchronized secret routine.',
    glowColor: '#FBD1E4',
  },
] as const;

type DapOption = (typeof DAP_OPTIONS)[number]['id'];

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

type OrderState = 'idle' | 'matching' | 'arriving';

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
  const [locationPrompt, setLocationPrompt] = useState<LocationPromptState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false);
  const [selectedDap, setSelectedDap] = useState<DapOption>('UberDap');
  const [orderState, setOrderState] = useState<OrderState>('idle');
  const [matchSecondsRemaining, setMatchSecondsRemaining] = useState(180);
  const [showMinigame, setShowMinigame] = useState(false);
  const [incomingDapperRequest, setIncomingDapperRequest] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const { height: viewportHeight } = useWindowDimensions();
  const sheetHeight = Math.min(480, viewportHeight * 0.58);
  const sheetProgress = useRef(new Animated.Value(0)).current;

  // Radar Pulse Animation
  const radarAnim1 = useRef(new Animated.Value(0)).current;
  const radarAnim2 = useRef(new Animated.Value(0)).current;

  // Mode Slider Animation
  const modeSliderAnim = useRef(new Animated.Value(activeMode === 'dapper' ? 1 : 0)).current;

  // Arriving card spring
  const arrivingCardSpring = useRef(new Animated.Value(0)).current;

  const isMountedRef = useRef(true);
  const activeModeRef = useRef(activeMode);
  activeModeRef.current = activeMode;
  const goOnlineRequestIdRef = useRef(0);

  const {
    connectionError,
    goOffline,
    goOnline,
  } = useDapperLocationStream(token, activeMode === 'dapper');

  // Start radar loops
  useEffect(() => {
    function createRadarLoop(anim: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
    }

    const loop1 = createRadarLoop(radarAnim1, 0);
    const loop2 = createRadarLoop(radarAnim2, 900);
    loop1.start();
    loop2.start();

    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [radarAnim1, radarAnim2]);

  // Mode transition animation
  useEffect(() => {
    Animated.spring(modeSliderAnim, {
      toValue: activeMode === 'dapper' ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  }, [activeMode, modeSliderAnim]);

  // Clean up on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      goOnlineRequestIdRef.current += 1;
    };
  }, []);

  // Sync mode changes
  useEffect(() => {
    activeModeRef.current = activeMode;

    if (activeMode !== 'dapper') {
      goOnlineRequestIdRef.current += 1;
      setIsDapperOnline(false);
      setIsGoingOnline(false);
      setLocation(null);
      setLocationPrompt(null);
      setIncomingDapperRequest(false);
    }

    if (activeMode !== 'order') {
      sheetProgress.stopAnimation();
      sheetProgress.setValue(0);
      setIsRequestMenuOpen(false);
      setOrderState('idle');
    }
  }, [activeMode, sheetProgress]);

  // Matching countdown timer
  useEffect(() => {
    if (orderState !== 'matching') return;

    const interval = setInterval(() => {
      setMatchSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleMatchFound();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Auto-match after 4 seconds for a snappy demo experience
    const autoMatchTimer = setTimeout(() => {
      handleMatchFound();
    }, 4500);

    return () => {
      clearInterval(interval);
      clearTimeout(autoMatchTimer);
    };
  }, [orderState]);

  // In Dapper mode: simulate incoming request after being online for 3 seconds
  useEffect(() => {
    if (activeMode === 'dapper' && isDapperOnline && !incomingDapperRequest) {
      const timer = setTimeout(() => {
        if (isMountedRef.current && isDapperOnline) {
          setIncomingDapperRequest(true);
        }
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [activeMode, isDapperOnline, incomingDapperRequest]);

  function handleMatchFound() {
    setOrderState('arriving');
    Animated.spring(arrivingCardSpring, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 8,
      speed: 14,
    }).start();
  }

  function resetDapperLocationState() {
    goOnlineRequestIdRef.current += 1;
    setIsDapperOnline(false);
    setIsGoingOnline(false);
    setLocation(null);
    setLocationPrompt(null);
    setIncomingDapperRequest(false);
    goOffline();
  }

  function handleSelectMode(nextMode: AppMode) {
    setIsMenuOpen(false);
    if (nextMode === activeMode) return;

    if (nextMode !== 'dapper') {
      resetDapperLocationState();
    }
    if (nextMode !== 'order') {
      sheetProgress.stopAnimation();
      sheetProgress.setValue(0);
      setIsRequestMenuOpen(false);
      setOrderState('idle');
    }
    onChangeMode(nextMode);
  }

  async function handleGoOnline() {
    if (isSubmitting || activeModeRef.current !== 'dapper' || isDapperOnline || isGoingOnline) {
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
              getForegroundPermissionsAsync: () => Location.getForegroundPermissionsAsync(),
              requestForegroundPermissionsAsync: () => Location.requestForegroundPermissionsAsync(),
              getCurrentPositionAsync: () =>
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            },
            { isNative: true },
          );

    if (!isCurrentAttempt()) return;

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

  function openRequestMenu() {
    setIsMenuOpen(false);
    setIsRequestMenuOpen(true);
    setOrderState('idle');
    sheetProgress.setValue(0);
    Animated.spring(sheetProgress, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 6,
      speed: 16,
    }).start();
  }

  function closeRequestMenu() {
    setOrderState('idle');
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

  function confirmRequest() {
    setOrderState('matching');
    setMatchSecondsRemaining(180);
  }

  function handleAcceptIncomingDap() {
    setIncomingDapperRequest(false);
    setShowMinigame(true);
  }

  function handleDeclineIncomingDap() {
    setIncomingDapperRequest(false);
  }

  function handleFinishMinigame() {
    setShowMinigame(false);
    setOrderState('idle');
    closeRequestMenu();
    setSuccessToast('Dap completed! You both achieved maximum resonance.');
    setTimeout(() => {
      setSuccessToast(null);
    }, 4000);
  }

  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });

  const modeSliderTranslateX = modeSliderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 118],
  });

  const isDapperMode = activeMode === 'dapper';
  const displayedLocation = isDapperMode && isDapperOnline ? location : null;

  return (
    <View style={styles.container}>
      {/* Background Map */}
      <View style={styles.mapLayer}>
        <MapSurface location={displayedLocation} mode={activeMode} />
      </View>

      {/* Radar scanning effect overlay when matching or online */}
      {(orderState === 'matching' || (isDapperMode && isDapperOnline)) && (
        <View pointerEvents="none" style={styles.radarCenter}>
          <Animated.View
            style={[
              styles.radarRing,
              {
                transform: [
                  {
                    scale: radarAnim1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.2, 3],
                    }),
                  },
                ],
                opacity: radarAnim1.interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [0.65, 0.25, 0],
                }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.radarRing,
              {
                transform: [
                  {
                    scale: radarAnim2.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.2, 3],
                    }),
                  },
                ],
                opacity: radarAnim2.interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [0.65, 0.25, 0],
                }),
              },
            ]}
          />
        </View>
      )}

      {/* Floating UI Overlay */}
      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        {/* Top Header Bar */}
        <View pointerEvents="box-none" style={styles.topBar}>
          {/* Animated Uber Mode Switcher */}
          <View style={styles.modeToggleContainer}>
            <Animated.View
              style={[
                styles.modeActivePill,
                { transform: [{ translateX: modeSliderTranslateX }] },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => handleSelectMode('order')}
              style={styles.modeTabButton}
            >
              <Text
                style={[
                  styles.modeTabButtonText,
                  activeMode === 'order' && styles.modeTabTextActive,
                ]}
              >
                Order a Dap
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => handleSelectMode('dapper')}
              style={styles.modeTabButton}
            >
              <Text
                style={[
                  styles.modeTabButtonText,
                  activeMode === 'dapper' && styles.modeTabTextActive,
                ]}
              >
                Dapper
              </Text>
            </Pressable>
          </View>

          {/* Account Menu Button */}
          <View style={styles.topRight}>
            <Pressable
              accessibilityLabel="Account menu"
              accessibilityRole="button"
              onPress={() => setIsMenuOpen((prev) => !prev)}
              style={styles.menuButton}
            >
              <View style={styles.hamburger}>
                <View style={styles.hamburgerBar} />
                <View style={styles.hamburgerBar} />
                <View style={styles.hamburgerBar} />
              </View>
            </Pressable>

            {isMenuOpen && (
              <View style={styles.menuDropdown}>
                {error ? <Text style={styles.menuError}>{error}</Text> : null}
                <Pressable onPress={onSignOut} style={styles.menuDropdownItem}>
                  <Text style={styles.menuDropdownText}>Sign out</Text>
                </Pressable>
                <Pressable onPress={onDeleteAccount} style={styles.menuDropdownItem}>
                  <Text style={styles.menuDeleteText}>Delete account</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* Dapper Mode Live Request Banner */}
        {isDapperMode && isDapperOnline && incomingDapperRequest && (
          <View style={styles.incomingBannerContainer}>
            <View style={styles.incomingBanner}>
              <View style={styles.incomingHeader}>
                <View style={styles.livePulseDot} />
                <Text style={styles.incomingKicker}>NEW DAP REQUEST NEARBY</Text>
              </View>
              <Text style={styles.incomingTitle}>UberDap Plus • 0.2 mi away</Text>
              <Text style={styles.incomingSub}>Julian wants a high-energy two-hand dap.</Text>
              <View style={styles.incomingActions}>
                <Pressable
                  onPress={handleDeclineIncomingDap}
                  style={styles.incomingDeclineButton}
                >
                  <Text style={styles.incomingDeclineText}>Decline</Text>
                </Pressable>
                <Pressable
                  onPress={handleAcceptIncomingDap}
                  style={styles.incomingAcceptButton}
                >
                  <Text style={styles.incomingAcceptText}>Accept & Fulfill</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* Success Toast */}
        {successToast && (
          <View pointerEvents="none" style={styles.toastContainer}>
            <View style={styles.toast}>
              <Text style={styles.toastText}>{successToast}</Text>
            </View>
          </View>
        )}

        {/* Bottom Actions for Order / Dapper Mode */}
        {!isRequestMenuOpen && (
          <View pointerEvents="box-none" style={styles.bottomBar}>
            {isDapperMode ? (
              <View style={styles.dapperBottomCard}>
                <View style={styles.dapperStatusRow}>
                  <View
                    style={[
                      styles.statusIndicatorDot,
                      isDapperOnline && styles.statusIndicatorOnline,
                    ]}
                  />
                  <Text style={styles.dapperStatusText}>
                    {isDapperOnline
                      ? 'You are online • Scanning for requests'
                      : 'You are offline'}
                  </Text>
                </View>

                {connectionError ? (
                  <Text style={styles.connectionErrorText}>{connectionError}</Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting || isGoingOnline}
                  onPress={() => {
                    if (isDapperOnline) {
                      handleGoOffline();
                    } else {
                      void handleGoOnline();
                    }
                  }}
                  style={[
                    styles.primaryPillButton,
                    isDapperOnline && styles.offlinePillButton,
                  ]}
                >
                  {isGoingOnline ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.primaryPillButtonText}>
                      {isDapperOnline ? 'Go Offline' : 'Go Online'}
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={openRequestMenu}
                style={({ pressed }) => [
                  styles.primaryPillButton,
                  styles.requestUberDapButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryPillButtonText}>Request UberDap</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Slide-Up Bottom Drawer for Ordering */}
        {isRequestMenuOpen && (
          <Animated.View
            style={[
              styles.requestSheet,
              {
                height: sheetHeight,
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            {/* Sheet Drag Handle */}
            <View style={styles.sheetHandle} />

            {/* Header */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {orderState === 'idle'
                  ? 'Choose your UberDap'
                  : orderState === 'matching'
                    ? 'Matching with a Dapper...'
                    : 'Dapper Arriving!'}
              </Text>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                onPress={closeRequestMenu}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseText}>
                  {orderState === 'idle' ? 'Close' : 'Cancel'}
                </Text>
              </Pressable>
            </View>

            {/* State: Choosing Tier */}
            {orderState === 'idle' && (
              <View style={styles.tierList}>
                {DAP_OPTIONS.map((option) => {
                  const isSelected = selectedDap === option.id;

                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="radio"
                      onPress={() => setSelectedDap(option.id)}
                      style={({ pressed }) => [
                        styles.tierCard,
                        isSelected && [
                          styles.tierCardSelected,
                          Platform.OS === 'web'
                            ? ({
                                boxShadow: `0 0 12px 1px ${option.glowColor}`,
                              } as any)
                            : { shadowColor: option.glowColor, shadowOpacity: 0.6, shadowRadius: 8 },
                        ],
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View style={styles.tierCardLeft}>
                        <View style={styles.tierTitleRow}>
                          <Text style={styles.tierTitle}>{option.title}</Text>
                          <View
                            style={[
                              styles.tierBadge,
                              { backgroundColor: option.glowColor },
                            ]}
                          >
                            <Text style={styles.tierBadgeText}>{option.tag}</Text>
                          </View>
                        </View>
                        <Text style={styles.tierDescription}>
                          {option.description}
                        </Text>
                      </View>
                      <View style={styles.tierCardRight}>
                        <Text style={styles.tierTime}>{option.time}</Text>
                        <View
                          style={[
                            styles.radioCircle,
                            isSelected && styles.radioCircleSelected,
                          ]}
                        >
                          {isSelected && <View style={styles.radioInnerDot} />}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}

                <Pressable
                  accessibilityRole="button"
                  onPress={confirmRequest}
                  style={({ pressed }) => [
                    styles.primaryPillButton,
                    styles.confirmButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryPillButtonText}>
                    Confirm {selectedDap}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* State: Matching Radar */}
            {orderState === 'matching' && (
              <View style={styles.matchingContainer}>
                <ActivityIndicator color="#000000" size="large" />
                <Text style={styles.matchingTitle}>Finding nearby Dappers...</Text>
                <Text style={styles.matchingSub}>
                  Scanning certified dappers with highest resonance ratings.
                </Text>
                <Text style={styles.matchingTimer}>
                  Estimated match in {matchSecondsRemaining}s
                </Text>

                {/* Instant match shortcut for hackathon demos */}
                <Pressable
                  onPress={handleMatchFound}
                  style={styles.demoShortcutButton}
                >
                  <Text style={styles.demoShortcutText}>⚡ Match Now (Demo)</Text>
                </Pressable>
              </View>
            )}

            {/* State: Dapper Arriving Card */}
            {orderState === 'arriving' && (
              <Animated.View
                style={[
                  styles.arrivingCard,
                  {
                    transform: [
                      {
                        scale: arrivingCardSpring.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.94, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.dapperProfileRow}>
                  <View style={styles.dapperAvatar}>
                    <Text style={styles.dapperAvatarText}>🤝</Text>
                  </View>
                  <View style={styles.dapperInfo}>
                    <Text style={styles.dapperName}>Marcus "Crisp Clap" Vance</Text>
                    <Text style={styles.dapperRating}>★ 4.99 • 487 Daps Delivered</Text>
                    <Text style={styles.dapperTransport}>⚡ Razor Scooter • Arriving now</Text>
                  </View>
                </View>

                <View style={styles.etaBar}>
                  <View style={styles.etaProgress} />
                </View>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowMinigame(true)}
                  style={({ pressed }) => [
                    styles.primaryPillButton,
                    styles.dapNowButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryPillButtonText}>
                    🔥 DAPPER ARRIVED! DAP UP NOW
                  </Text>
                </Pressable>
              </Animated.View>
            )}
          </Animated.View>
        )}

        {/* Location Permission / Prompt Modal */}
        {isDapperMode && locationPrompt && (
          <View style={styles.promptOverlay}>
            <View style={styles.promptCard}>
              <Text style={styles.promptTitle}>Location Required</Text>
              <Text style={styles.promptMessage}>{locationPrompt.message}</Text>
              <View style={styles.promptActions}>
                <Pressable
                  onPress={() => void handleGoOnline()}
                  style={styles.promptPrimaryButton}
                >
                  <Text style={styles.promptPrimaryButtonText}>Try again</Text>
                </Pressable>
                {locationPrompt.canOpenSettings && Platform.OS !== 'web' && (
                  <Pressable
                    onPress={() => void Linking.openSettings()}
                    style={styles.promptSecondaryButton}
                  >
                    <Text style={styles.promptSecondaryButtonText}>
                      Open settings
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setLocationPrompt(null)}
                  style={styles.promptCancelButton}
                >
                  <Text style={styles.promptCancelButtonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* Minigame Modal */}
        {showMinigame && (
          <DapMinigame
            dapTier={selectedDap}
            dapperName='Marcus "Crisp Clap" Vance'
            onClose={handleFinishMinigame}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 10,
  },
  radarCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 5,
  },
  radarRing: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 3,
    borderColor: '#000000',
  },
  topBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 1200,
    elevation: 12,
  },
  modeToggleContainer: {
    width: 236,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ececec',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 2,
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  modeActivePill: {
    position: 'absolute',
    width: 114,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#000000',
  },
  modeTabButton: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  modeTabButtonText: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
  },
  modeTabTextActive: {
    color: '#ffffff',
  },
  topRight: {
    position: 'relative',
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  hamburger: {
    width: 18,
    height: 12,
    justifyContent: 'space-between',
  },
  hamburgerBar: {
    height: 2,
    borderRadius: 1,
    backgroundColor: '#000000',
  },
  menuDropdown: {
    position: 'absolute',
    top: 52,
    right: 0,
    width: 170,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 8,
  },
  menuDropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuDropdownText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  menuDeleteText: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  menuError: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    zIndex: 1100,
    elevation: 11,
  },
  primaryPillButton: {
    height: 56,
    borderRadius: 14,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  requestUberDapButton: {
    width: '100%',
  },
  primaryPillButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  dapperBottomCard: {
    borderRadius: 18,
    backgroundColor: '#ffffff',
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    gap: 12,
  },
  dapperStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusIndicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#999999',
  },
  statusIndicatorOnline: {
    backgroundColor: '#27ae60',
  },
  dapperStatusText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  connectionErrorText: {
    color: '#ee4d4d',
    fontFamily: displayFontFamily,
    fontSize: 13,
  },
  offlinePillButton: {
    backgroundColor: '#ececec',
  },
  requestSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 16,
    zIndex: 1500,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#dddddd',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  sheetCloseButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  sheetCloseText: {
    color: '#777777',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  tierList: {
    gap: 10,
  },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    backgroundColor: '#ececec',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tierCardSelected: {
    backgroundColor: '#ffffff',
    borderColor: '#000000',
  },
  tierCardLeft: {
    flex: 1,
    gap: 4,
  },
  tierTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tierTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 17,
    fontWeight: '700',
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tierBadgeText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tierDescription: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 13,
  },
  tierCardRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  tierTime: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '700',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#bbbbbb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#000000',
  },
  radioInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#000000',
  },
  confirmButton: {
    marginTop: 8,
  },
  matchingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  matchingTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  matchingSub: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 280,
  },
  matchingTimer: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  demoShortcutButton: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#ececec',
  },
  demoShortcutText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 12,
    fontWeight: '700',
  },
  arrivingCard: {
    gap: 16,
    paddingVertical: 10,
  },
  dapperProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#ececec',
    borderRadius: 14,
    padding: 14,
  },
  dapperAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dapperAvatarText: {
    fontSize: 24,
  },
  dapperInfo: {
    flex: 1,
    gap: 2,
  },
  dapperName: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
  dapperRating: {
    color: '#444444',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  dapperTransport: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 12,
  },
  etaBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ececec',
    overflow: 'hidden',
  },
  etaProgress: {
    width: '90%',
    height: '100%',
    backgroundColor: '#B3EEC9',
  },
  dapNowButton: {
    backgroundColor: '#000000',
  },
  incomingBannerContainer: {
    position: 'absolute',
    top: 76,
    left: 16,
    right: 16,
    zIndex: 1300,
  },
  incomingBanner: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#B3EEC9',
  },
  incomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#27ae60',
  },
  incomingKicker: {
    color: '#27ae60',
    fontFamily: displayFontFamily,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  incomingTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 18,
    fontWeight: '700',
  },
  incomingSub: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 13,
  },
  incomingActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  incomingDeclineButton: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#ececec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  incomingDeclineText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  incomingAcceptButton: {
    flex: 2,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  incomingAcceptText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
  },
  toastContainer: {
    position: 'absolute',
    top: 76,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 1400,
  },
  toast: {
    borderRadius: 12,
    backgroundColor: '#000000',
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  toastText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  promptOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 1600,
  },
  promptCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  promptTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 18,
    fontWeight: '700',
  },
  promptMessage: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  promptActions: {
    width: '100%',
    gap: 8,
    marginTop: 6,
  },
  promptPrimaryButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptPrimaryButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
  },
  promptSecondaryButton: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptSecondaryButtonText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  promptCancelButton: {
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptCancelButtonText: {
    color: '#777777',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});
