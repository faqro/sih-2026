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

import type { AppMode, DapService } from '../api/auth';
import { useDapRequest } from '../hooks/useDapRequest';
import { useDapperLocationStream } from '../hooks/useDapperLocationStream';
import MapSurface from './MapSurface';

const dapOptions = ['UberDap', 'UberDap Plus', 'UberDap Deluxe'] as const;
type DapOption = (typeof dapOptions)[number];

type MapScreenProps = {
  activeMode: AppMode;
  error: string | null;
  isSavingPreferences: boolean;
  isSubmitting: boolean;
  offeredServices: DapService[];
  onChangeMode: (nextMode: AppMode) => void;
  onDeleteAccount: () => void;
  onSaveDapperPreferences: (
    offeredServices: DapService[],
  ) => Promise<boolean>;
  onSignOut: () => void;
  token: string;
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
  isSavingPreferences,
  isSubmitting,
  offeredServices,
  onChangeMode,
  onDeleteAccount,
  onSaveDapperPreferences,
  onSignOut,
  token,
}: MapScreenProps) {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [selectedServices, setSelectedServices] =
    useState<DapService[]>(offeredServices);
  const [selectedDap, setSelectedDap] = useState<DapOption>('UberDap');
  const [showMatchToast, setShowMatchToast] = useState(false);
  const [isDapperSheetOpen, setIsDapperSheetOpen] = useState(false);
  const { height: viewportHeight } = useWindowDimensions();
  const sheetHeight = viewportHeight / 2;
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const preferencesProgress = useRef(new Animated.Value(0)).current;
  const dapperSheetProgress = useRef(new Animated.Value(0)).current;
  const dapperContentRef = useRef(false);
  const dapperSheetOpenRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  const preferencesTranslateY = preferencesProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  const dapperSheetTranslateY = dapperSheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  const dapRequest = useDapRequest(token, activeMode === 'order');
  const {
    acceptOffer,
    activeDap,
    connectionError,
    declineOffer,
    goOffline,
    goOnline,
    isResponding,
    isConnecting,
    isOnline,
    markDapDelivered,
    offer,
  } = useDapperLocationStream(
    token,
    activeMode === 'dapper' && offeredServices.length > 0,
  );
  const hasDapperContent =
    activeMode === 'dapper' && (offer !== null || activeDap !== null);
  dapperContentRef.current = hasDapperContent;

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

  useEffect(() => {
    setSelectedServices(offeredServices);
  }, [offeredServices]);

  useEffect(() => {
    if (
      (dapRequest.status === 'connecting' ||
        dapRequest.status === 'searching' ||
        dapRequest.status === 'matched') &&
      !isRequestMenuOpen
    ) {
      openRequestMenu();
    }

    if (dapRequest.status === 'failed') {
      if (dapRequest.error === null) {
        setShowMatchToast(true);
        if (toastTimeoutRef.current) {
          clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
          setShowMatchToast(false);
          toastTimeoutRef.current = null;
        }, 3000);
      }

      if (!isRequestMenuOpen) {
        openRequestMenu();
      }
    }
  }, [dapRequest.error, dapRequest.status]);

  useEffect(() => {
    if (hasDapperContent) {
      dapperSheetOpenRef.current = true;
      setIsDapperSheetOpen(true);
      Animated.spring(dapperSheetProgress, {
        toValue: 1,
        useNativeDriver: true,
        damping: 22,
        stiffness: 160,
      }).start();
      return;
    }

    if (dapperSheetOpenRef.current) {
      Animated.timing(dapperSheetProgress, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !dapperContentRef.current) {
          dapperSheetOpenRef.current = false;
          setIsDapperSheetOpen(false);
        }
      });
    }
  }, [dapperSheetProgress, hasDapperContent]);

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
    dapRequest.cancelRequest();
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

  function openPreferences() {
    setIsMenuOpen(false);
    setSelectedServices(offeredServices);
    setIsPreferencesOpen(true);
    preferencesProgress.setValue(0);
    Animated.timing(preferencesProgress, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }

  function closePreferences() {
    Animated.timing(preferencesProgress, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsPreferencesOpen(false);
      }
    });
  }

  function toggleService(service: DapService) {
    setSelectedServices((current) =>
      current.includes(service)
        ? current.filter((item) => item !== service)
        : [...current, service],
    );
  }

  async function savePreferences() {
    if (selectedServices.length === 0 || isSavingPreferences) {
      return;
    }

    if (await onSaveDapperPreferences(selectedServices)) {
      closePreferences();
    }
  }

  function selectMapMode(nextMode: AppMode) {
    if (nextMode === 'dapper' && offeredServices.length === 0) {
      openPreferences();
      return;
    }

    onChangeMode(nextMode);
  }

  function confirmRequest() {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    setShowMatchToast(false);
    if (location) {
      void dapRequest.startRequest(selectedDap, location);
    }
  }

  function toggleDapperAvailability() {
    if (isOnline) {
      goOffline();
    } else if (offeredServices.length === 0) {
      openPreferences();
    } else {
      void goOnline();
    }
  }

  const matchMinutesRemaining = Math.ceil(dapRequest.secondsRemaining / 60);
  const formattedMinutes = Math.floor(dapRequest.secondsRemaining / 60);
  const formattedSeconds = String(dapRequest.secondsRemaining % 60).padStart(
    2,
    '0',
  );
  const formattedSecondsRemaining = `${formattedMinutes}:${formattedSeconds}`;
  const requestInProgress =
    dapRequest.status === 'connecting' ||
    dapRequest.status === 'searching' ||
    dapRequest.status === 'matched';
  const mapLocation =
    activeMode === 'dapper'
      ? activeDap?.location ?? offer?.location ?? location
      : location;

  return (
    <View style={styles.container}>
      <View style={styles.mapLayer}>
        {mapLocation ? (
          <MapSurface
            location={mapLocation}
            mode={activeDap || offer ? 'order' : activeMode}
          />
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

      {activeMode === 'dapper' && connectionError ? (
        <View style={styles.locationMessage}>
          <Text style={styles.messageText}>{connectionError}</Text>
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
                  disabled={
                    isSubmitting ||
                    isSavingPreferences ||
                    requestInProgress ||
                    activeDap !== null
                  }
                  onPress={() => selectMapMode(tab.mode)}
                  style={[
                    styles.modeTab,
                    isSelected && styles.modeTabSelected,
                    (isSubmitting ||
                      isSavingPreferences ||
                      requestInProgress ||
                      activeDap !== null) &&
                      styles.disabledButton,
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
              disabled={isSubmitting || isSavingPreferences}
              onPress={() => setIsMenuOpen((isOpen) => !isOpen)}
              style={[
                styles.menuButton,
                (isSubmitting || isSavingPreferences) && styles.disabledButton,
              ]}
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
                  disabled={isSubmitting || isSavingPreferences}
                  onPress={openPreferences}
                  style={styles.menuItem}
                >
                  <Text style={styles.preferencesMenuText}>Preferences</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={() => {
                    dapRequest.cancelRequest();
                    onSignOut();
                  }}
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
          {activeMode === 'dapper' ? (
            <Text style={styles.dapperStatus}>
              {activeDap
                ? 'You are busy with an active UberDap.'
                : offeredServices.length === 0
                  ? 'Select at least one service in Preferences to go online.'
                : isOnline
                ? 'Your location is being shared while you are online.'
                : 'Your location stays private while you are offline.'}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={
              isSubmitting ||
              (activeMode === 'dapper' && isConnecting) ||
              (activeMode === 'order' && dapRequest.isRestoring)
            }
            onPress={
              activeMode === 'dapper'
                ? toggleDapperAvailability
                : () => {
                    if (dapRequest.status === 'delivered') {
                      dapRequest.resetRequest();
                    }
                    openRequestMenu();
                  }
            }
            style={[
              styles.requestButton,
              activeMode === 'dapper' && styles.goOnlineButton,
              activeMode === 'dapper' && isOnline && styles.goOfflineButton,
              (isSubmitting ||
                (activeMode === 'dapper' && isConnecting) ||
                (activeMode === 'order' && dapRequest.isRestoring)) &&
                styles.disabledButton,
            ]}
          >
            {isConnecting ||
            (activeMode === 'order' && dapRequest.isRestoring) ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.requestButtonText}>
                {activeMode === 'dapper'
                  ? offeredServices.length === 0
                    ? 'Choose Services'
                    : isOnline
                    ? 'Go Offline'
                    : 'Go Online'
                  : dapRequest.status === 'matched'
                    ? 'View Your UberDap'
                    : dapRequest.status === 'searching' ||
                        dapRequest.status === 'connecting'
                      ? 'Matching...'
                      : dapRequest.status === 'delivered'
                        ? 'Request Another UberDap'
                        : 'Request UberDap'}
              </Text>
            )}
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
              <Text style={styles.sheetTitle}>
                {dapRequest.status === 'matched'
                  ? 'Your UberDap'
                  : dapRequest.status === 'delivered'
                    ? 'UberDap delivered'
                    : dapRequest.status === 'connecting'
                      ? 'Connecting'
                      : dapRequest.status === 'searching'
                        ? 'Finding a dapper'
                        : 'Choose your UberDap'}
              </Text>
              <Pressable
                accessibilityLabel="Close request menu"
                accessibilityRole="button"
                onPress={closeRequestMenu}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseText}>
                  {dapRequest.status === 'connecting' ||
                  dapRequest.status === 'searching'
                    ? 'Cancel'
                    : 'Close'}
                </Text>
              </Pressable>
            </View>
            {dapRequest.status === 'idle' || dapRequest.status === 'failed' ? (
              <>
                {dapRequest.error ? (
                  <Text style={styles.matchingError}>{dapRequest.error}</Text>
                ) : null}
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
                  disabled={!location || isLocating}
                  onPress={confirmRequest}
                  style={[
                    styles.confirmButton,
                    (!location || isLocating) && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.confirmButtonText}>
                    Confirm UberDap
                  </Text>
                </Pressable>
              </>
            ) : dapRequest.status === 'connecting' ||
              dapRequest.status === 'searching' ? (
              <View style={styles.matchingContent}>
                <ActivityIndicator color="#314b9a" size="large" />
                {dapRequest.status === 'connecting' ? (
                  <Text style={styles.matchingText}>
                    Connecting to the dapper network...
                  </Text>
                ) : (
                  <>
                    <Text style={styles.matchingText}>
                      Matching you with a dapper within the next{' '}
                      {matchMinutesRemaining}{' '}
                      {matchMinutesRemaining === 1 ? 'minute' : 'minutes'}...
                    </Text>
                    <Text style={styles.matchingCountdown}>
                      {formattedSecondsRemaining} remaining
                    </Text>
                  </>
                )}
              </View>
            ) : dapRequest.status === 'matched' ? (
              <View style={styles.matchingContent}>
                <Text style={styles.matchSuccessText}>
                  Your UberDap will arrive soon.
                </Text>
                <Text style={styles.matchedDapperName}>
                  {dapRequest.matchedDapper?.username}
                </Text>
                <Text style={styles.crispinessStars}>★★½☆☆</Text>
                <Text style={styles.crispinessRating}>
                  Crispiness Rating:{' '}
                  {dapRequest.matchedDapper?.crispinessRating.toFixed(1)} / 5
                </Text>
              </View>
            ) : (
              <View style={styles.matchingContent}>
                <Text style={styles.matchSuccessText}>
                  Your UberDap has been delivered.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={dapRequest.resetRequest}
                  style={styles.confirmButton}
                >
                  <Text style={styles.confirmButtonText}>
                    Request another UberDap
                  </Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        ) : null}

        {isPreferencesOpen ? (
          <Animated.View
            style={[
              styles.preferencesSheet,
              {
                height: sheetHeight,
                transform: [{ translateY: preferencesTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Dapper Preferences</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isSavingPreferences}
                onPress={closePreferences}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.preferencesDescription}>
              Select at least one service you offer.
            </Text>
            <View style={styles.options}>
              {dapOptions.map((service) => {
                const isSelected = selectedServices.includes(service);

                return (
                  <Pressable
                    accessibilityLabel={service}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    disabled={isSavingPreferences}
                    key={service}
                    onPress={() => toggleService(service)}
                    style={[
                      styles.optionButton,
                      isSelected && styles.optionButtonSelected,
                      isSavingPreferences && styles.disabledButton,
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
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {service}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {error ? <Text style={styles.preferencesError}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={selectedServices.length === 0 || isSavingPreferences}
              onPress={() => void savePreferences()}
              style={[
                styles.confirmButton,
                (selectedServices.length === 0 || isSavingPreferences) &&
                  styles.disabledButton,
              ]}
            >
              {isSavingPreferences ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.confirmButtonText}>Save Preferences</Text>
              )}
            </Pressable>
          </Animated.View>
        ) : null}

        {isDapperSheetOpen ? (
          <Animated.View
            style={[
              styles.dapperSheet,
              {
                height: sheetHeight,
                transform: [{ translateY: dapperSheetTranslateY }],
              },
            ]}
          >
            <Text style={styles.dapperSheetTitle}>
              {activeDap ? 'UberDap accepted' : 'New UberDap request'}
            </Text>
            {activeDap ? (
              <>
                <Text style={styles.dapperSheetService}>
                  {activeDap.service}
                </Text>
                <Text style={styles.dapperSheetText}>
                  Requested by {activeDap.userName}
                </Text>
                <Text style={styles.dapperSheetText}>
                  Travel to {activeDap.location.latitude.toFixed(5)},{' '}
                  {activeDap.location.longitude.toFixed(5)}
                </Text>
                {!isOnline ? (
                  <Text style={styles.dapperSheetHint}>
                    Go online again to mark this dap delivered.
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={!isOnline || isResponding}
                  onPress={markDapDelivered}
                  style={[
                    styles.deliveredButton,
                    (!isOnline || isResponding) && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.deliveredButtonText}>
                    {isResponding ? 'Updating...' : 'Dap Delivered'}
                  </Text>
                </Pressable>
              </>
            ) : offer ? (
              <>
                <Text style={styles.dapperSheetService}>{offer.service}</Text>
                <Text style={styles.dapperSheetText}>
                  Requested by {offer.userName}
                </Text>
                <Text style={styles.dapperSheetText}>
                  {offer.distanceKm.toFixed(1)} km away
                </Text>
                <Text style={styles.dapperSheetText}>
                  Location: {offer.location.latitude.toFixed(5)},{' '}
                  {offer.location.longitude.toFixed(5)}
                </Text>
                <View style={styles.offerActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isResponding}
                    onPress={declineOffer}
                    style={[
                      styles.declineButton,
                      isResponding && styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isResponding}
                    onPress={acceptOffer}
                    style={[
                      styles.acceptButton,
                      isResponding && styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.acceptButtonText}>
                      {isResponding ? 'Responding...' : 'Accept'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
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
  preferencesMenuText: {
    color: '#34425c',
    fontSize: 14,
    fontWeight: '700',
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
  preferencesSheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1106,
    elevation: 18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
  },
  preferencesDescription: {
    color: '#6f7a90',
    fontSize: 14,
    marginBottom: 14,
  },
  preferencesError: {
    color: '#b42318',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
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
  serviceCheckbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#aab3c3',
    borderRadius: 6,
    marginRight: 13,
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
  matchingError: {
    color: '#b42318',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
    textAlign: 'center',
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
  matchSuccessText: {
    color: '#34425c',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  matchedDapperName: {
    color: '#172033',
    fontSize: 23,
    fontWeight: '700',
    marginTop: 20,
  },
  crispinessStars: {
    color: '#e0a800',
    fontSize: 25,
    letterSpacing: 2,
    marginTop: 8,
  },
  crispinessRating: {
    color: '#6f7a90',
    fontSize: 14,
    marginTop: 5,
  },
  dapperSheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1104,
    elevation: 15,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 22,
    backgroundColor: '#ffffff',
    shadowColor: '#172033',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
  },
  dapperSheetTitle: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 18,
  },
  dapperSheetService: {
    color: '#314b9a',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  dapperSheetText: {
    color: '#34425c',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  dapperSheetHint: {
    color: '#6f7a90',
    fontSize: 13,
    marginTop: 6,
  },
  offerActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  declineButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f0b8b5',
    borderRadius: 13,
  },
  declineButtonText: {
    color: '#b42318',
    fontSize: 16,
    fontWeight: '700',
  },
  acceptButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#16845b',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  deliveredButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    marginTop: 20,
    backgroundColor: '#16845b',
  },
  deliveredButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
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
