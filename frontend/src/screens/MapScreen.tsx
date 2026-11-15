import * as Location from 'expo-location';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Easing,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  fetchDapperRatings,
  submitDapRating,
  type AppMode,
  type AuthProvider,
  type DapService,
  type DapperRatingsResponse,
  type ProfileUpdatePayload,
} from '../api/auth';
import { useDapRequest } from '../hooks/useDapRequest';
import {
  resolveDapperOnlineLocation,
  resolveWebDapperOnlineLocation,
  type Coordinates,
  type DapperLocationFailureReason,
} from '../location/dapperLocation';
import {
  reverseGeocodeLocation,
  searchLocations,
  type LocationSearchResult,
} from '../location/locationSearch';
import { useDapperLocationStream } from '../hooks/useDapperLocationStream';
import MapSurface from './MapSurface';
import DapDecibelMeasurer from '../components/DapDecibelMeasurer';

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

const dapOptions = [
  'Dap for Poor People',
  'Dap (Standard)',
  'Dap (Wheelchair-Accessible)',
  'Dap & Dash',
  'THE GOD DAP',
  'Professional Handshake (Black-tie)',
] as const;
type DapOption = (typeof dapOptions)[number];
const dapOptionPrices: Record<DapOption, string> = {
  'Dap for Poor People': '$0.03',
  'Dap (Standard)': '$21.99',
  'Dap (Wheelchair-Accessible)': '$24.99',
  'Dap & Dash': '$16.99',
  'THE GOD DAP': '$124.99',
  'Professional Handshake (Black-tie)': '$529.99',
};

const DAP_DETAILS: Record<
  DapOption,
  { tag: string; time: string; description: string }
> = {
  'Dap for Poor People': {
    tag: 'BUDGET',
    time: '2 min',
    description: 'A basic dap at the lowest price.',
  },
  'Dap (Standard)': {
    tag: 'CLASSIC',
    time: '2 min',
    description: 'The classic single-contact dap.',
  },
  'Dap (Wheelchair-Accessible)': {
    tag: 'ACCESSIBLE',
    time: '3 min',
    description: 'A wheelchair-accessible dap meetup.',
  },
  'Dap & Dash': {
    tag: 'QUICK',
    time: '1 min',
    description: 'A quick dap with a fast exit.',
  },
  'THE GOD DAP': {
    tag: 'PREMIUM',
    time: '5 min',
    description: 'The ultimate dap experience.',
  },
  'Professional Handshake (Black-tie)': {
    tag: 'FORMAL',
    time: '5 min',
    description: 'A polished handshake for formal occasions.',
  },
};

const CRISPINESS_LABELS: Record<number, string> = {
  1: 'Soggy',
  2: 'Soft',
  3: 'Solid',
  4: 'Crispy',
  5: 'Ultra Crisp',
};

type MapScreenProps = {
  activeMode: AppMode;
  authProvider?: AuthProvider;
  crispinessRating?: number | null;
  crispinessRatingCount?: number;
  steamAvatar?: string | null;
  steamUsername?: string | null;
  stravaAvatar?: string | null;
  stravaUsername?: string | null;
  error: string | null;
  isChangingMode: boolean;
  isSavingPreferences: boolean;
  isSubmitting: boolean;
  name?: string | null;
  offeredServices: DapService[];
  onChangeMode: (nextMode: AppMode) => void;
  onDeleteAccount: () => void;
  onRatingReceived?: (payload: {
    crispinessRating: number;
    crispinessRatingCount: number;
  }) => void;
  onSaveDapperPreferences: (
    offeredServices: DapService[],
  ) => Promise<boolean>;
  onSignOut: () => void;
  onUpdateProfile: (
    payload: ProfileUpdatePayload,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  token: string;
  username?: string;
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
  authProvider = 'local',
  crispinessRating = null,
  crispinessRatingCount = 0,
  steamAvatar = null,
  steamUsername = null,
  stravaAvatar = null,
  stravaUsername = null,
  error,
  isChangingMode,
  isSavingPreferences,
  isSubmitting,
  name = null,
  offeredServices,
  onChangeMode,
  onDeleteAccount,
  onRatingReceived,
  onSaveDapperPreferences,
  onSignOut,
  onUpdateProfile,
  token,
  username,
}: MapScreenProps) {
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationTrackingRevision, setLocationTrackingRevision] = useState(0);
  const [locationTrackingError, setLocationTrackingError] = useState<
    string | null
  >(null);
  const [isDapperLocationReady, setIsDapperLocationReady] = useState(false);
  const [isGoingOnline, setIsGoingOnline] = useState(false);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [locationPrompt, setLocationPrompt] =
    useState<LocationPromptState | null>(null);
  const [requestLocationError, setRequestLocationError] = useState<
    string | null
  >(null);
  const [orderLocationMode, setOrderLocationMode] = useState<
    'current' | 'custom'
  >('current');
  const [customOrderLocation, setCustomOrderLocation] =
    useState<Coordinates | null>(null);
  const [customOrderLabel, setCustomOrderLabel] = useState<string | null>(null);
  const [isSearchBoxOpen, setIsSearchBoxOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>(
    [],
  );
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLocatingCurrent, setIsLocatingCurrent] = useState(false);
  const [isPinpointNoticeVisible, setIsPinpointNoticeVisible] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(name ?? '');
  const [profileUsername, setProfileUsername] = useState(username ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordCurrent, setPasswordCurrent] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [ratingsData, setRatingsData] = useState<DapperRatingsResponse | null>(
    null,
  );
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);
  const [ratingsError, setRatingsError] = useState<string | null>(null);
  const [pendingModeAfterPreferences, setPendingModeAfterPreferences] =
    useState<AppMode | null>(null);
  const [selectedServices, setSelectedServices] = useState<DapService[]>(
    () => availableDapperServices(offeredServices),
  );
  const [selectedDap, setSelectedDap] =
    useState<DapOption>('Dap (Standard)');
  const [showMatchToast, setShowMatchToast] = useState(false);
  const [isDapperSheetOpen, setIsDapperSheetOpen] = useState(false);
  const [selectedCrispinessRating, setSelectedCrispinessRating] = useState<
    number | null
  >(null);
  const [ratingComment, setRatingComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [isDapCompletedLocally, setIsDapCompletedLocally] = useState(false);
  const { height: viewportHeight } = useWindowDimensions();
  const sheetHeight = viewportHeight / 2;
  const profileSheetHeight = Math.min(Math.round(viewportHeight * 0.85), 680);
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const preferencesProgress = useRef(new Animated.Value(0)).current;
  const profileProgress = useRef(new Animated.Value(0)).current;
  const passwordSheetProgress = useRef(new Animated.Value(0)).current;
  const deleteSheetProgress = useRef(new Animated.Value(0)).current;
  const dapperSheetProgress = useRef(new Animated.Value(0)).current;
  const dapperContentRef = useRef(false);
  const dapperSheetOpenRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const activeModeRef = useRef(activeMode);
  const goOnlineRequestIdRef = useRef(0);
  const requestLocationRequestIdRef = useRef(0);
  const searchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const reverseGeocodeIdRef = useRef(0);
  activeModeRef.current = activeMode;
  const preferencesTranslateY = preferencesProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  const profileTranslateY = profileProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [profileSheetHeight, 0],
  });
  const passwordSheetHeight = Math.min(Math.round(viewportHeight * 0.72), 520);
  const passwordSheetTranslateY = passwordSheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [passwordSheetHeight, 0],
  });
  const deleteSheetHeight = Math.min(Math.round(viewportHeight * 0.62), 460);
  const deleteSheetTranslateY = deleteSheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [deleteSheetHeight, 0],
  });
  const dapperSheetTranslateY = dapperSheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  const dapRequest = useDapRequest(token, activeMode === 'order');
  const matchedSheetHeight = Math.min(Math.round(viewportHeight * 0.78), 580);
  const requestSheetHeight =
    dapRequest.status === 'matched' && !isDapCompletedLocally
      ? matchedSheetHeight
      : sheetHeight;
  const sheetTranslateY = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [requestSheetHeight, 0],
  });
  const {
    acceptOffer,
    activeDap,
    connectionError,
    declineOffer,
    goOffline,
    goOnline,
    isResponding,
    isConnecting,
    isOnline: isLocationStreamOnline,
    location: dapperLocation,
    markDapDelivered,
    offer,
  } = useDapperLocationStream(
    token,
    activeMode === 'dapper' && offeredServices.length > 0,
    (payload) => {
      onRatingReceived?.(payload);
      if (isProfileOpen) {
        void loadProfileRatings();
      }
    },
  );
  const isDapperMode = activeMode === 'dapper';
  const isDapperOnline = isDapperLocationReady && isLocationStreamOnline;
  const hasDapperContent =
    isDapperMode && (offer !== null || activeDap !== null);
  const isOrderRequestStreamingLocation =
    dapRequest.status === 'connecting' || dapRequest.status === 'searching';
  const activeOrderLocation =
    orderLocationMode === 'custom' && customOrderLocation
      ? customOrderLocation
      : location;
  const ownMapLocation = isDapperMode
    ? dapperLocation ?? location
    : isOrderRequestStreamingLocation
      ? dapRequest.userLocation ?? activeOrderLocation
      : activeOrderLocation ?? dapRequest.userLocation;
  const counterpartMapLocation = isDapperMode
    ? activeDap?.location ?? offer?.location ?? null
    : dapRequest.status === 'matched'
      ? dapRequest.matchedDapperLocation
      : null;
  dapperContentRef.current = hasDapperContent;

  useEffect(() => {
    if (
      isDapperOnline ||
      (activeMode === 'order' &&
        (dapRequest.status === 'connecting' ||
          dapRequest.status === 'searching'))
    ) {
      return;
    }

    let isActive = true;
    let subscription: Location.LocationSubscription | null = null;

    async function startMapLocationTracking() {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!isActive || permission.status !== 'granted') {
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!isActive) {
          return;
        }

        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationTrackingError(null);
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 3000,
          },
          (nextPosition) => {
            if (!isActive) {
              return;
            }
            setLocation({
              latitude: nextPosition.coords.latitude,
              longitude: nextPosition.coords.longitude,
            });
          },
        );

        if (!isActive) {
          subscription.remove();
          subscription = null;
        }
      } catch {
        if (isActive) {
          setLocationTrackingError(
            'Unable to refresh your map location. Check location access and try again.',
          );
        }
      }
    }

    void startMapLocationTracking();

    return () => {
      isActive = false;
      subscription?.remove();
    };
  }, [
    activeMode,
    dapRequest.status,
    isDapperOnline,
    locationTrackingRevision,
  ]);

  function resetDapperLocationState() {
    goOnlineRequestIdRef.current += 1;
    setIsDapperLocationReady(false);
    setIsGoingOnline(false);
    setLocation(null);
    setLocationPrompt(null);
    goOffline();
  }

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [steamAvatar, stravaAvatar]);

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
      setIsDapperLocationReady(false);
      setIsGoingOnline(false);
      setLocation(null);
      setLocationPrompt(null);
    }

    if (activeMode !== 'order') {
      requestLocationRequestIdRef.current += 1;
      setIsRequestingLocation(false);
      setRequestLocationError(null);
      setIsSearchBoxOpen(false);
      setIsPinpointNoticeVisible(false);
    }

    if (activeMode !== 'order') {
      sheetProgress.stopAnimation();
      sheetProgress.setValue(0);
      setIsRequestMenuOpen(false);
    }
  }, [activeMode, sheetProgress]);

  useEffect(() => {
    if (isDapperMode || !isSearchBoxOpen) {
      return;
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearchingLocations(false);
      return;
    }

    const controller = new AbortController();
    setIsSearchingLocations(true);
    setSearchError(null);

    const timeout = setTimeout(() => {
      void searchLocations(trimmed, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted && isMountedRef.current) {
            setSearchResults(results);
            setIsSearchingLocations(false);
          }
        })
        .catch((err) => {
          if (
            controller.signal.aborted ||
            (err instanceof Error && err.name === 'AbortError') ||
            !isMountedRef.current
          ) {
            return;
          }
          setSearchResults([]);
          setSearchError('Unable to search locations. Try again.');
          setIsSearchingLocations(false);
        });
    }, 350);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isDapperMode, isSearchBoxOpen, searchQuery]);

  function handleSelectMode(
    nextMode: AppMode,
    hasDapperServices = offeredServices.length > 0,
  ) {
    setIsMenuOpen(false);

    if (nextMode === activeMode || isChangingMode) {
      return;
    }

    if (nextMode === 'dapper' && !hasDapperServices) {
      openPreferences();
      return;
    }

    activeModeRef.current = nextMode;
    if (nextMode !== 'order') {
      requestLocationRequestIdRef.current += 1;
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

    if (offeredServices.length === 0) {
      openPreferences();
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
      setIsDapperLocationReady(false);
      setLocation(null);
      setLocationPrompt({
        reason: result.reason,
        canOpenSettings: result.canOpenSettings,
        message: result.message,
      });
      return;
    }

    setLocation(result.coordinates);
    setIsDapperLocationReady(true);
    setLocationPrompt(null);
    setLocationTrackingRevision((revision) => revision + 1);
    void goOnline(result.coordinates);
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
    requestLocationRequestIdRef.current += 1;
    dapRequest.cancelRequest();
    resetDapperLocationState();
    onSignOut();
  }

  function openDeleteModal() {
    setIsMenuOpen(false);
    setDeleteConfirmText('');
    setIsDeleteModalOpen(true);
    deleteSheetProgress.setValue(0);
    Animated.timing(deleteSheetProgress, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }

  function closeDeleteModal() {
    if (isSubmitting) {
      return;
    }
    Animated.timing(deleteSheetProgress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsDeleteModalOpen(false);
        setDeleteConfirmText('');
      }
    });
  }

  function handleDeleteAccount() {
    openDeleteModal();
  }

  function confirmDeleteAccount() {
    if (isSubmitting || deleteConfirmText.trim() !== 'DELETE') {
      return;
    }
    requestLocationRequestIdRef.current += 1;
    dapRequest.cancelRequest();
    resetDapperLocationState();
    onDeleteAccount();
  }

  useEffect(() => {
    setSelectedServices(availableDapperServices(offeredServices));
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
    if (dapRequest.status === 'idle') {
      setIsDapCompletedLocally(false);
    }
  }, [dapRequest.status]);

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
    requestLocationRequestIdRef.current += 1;
    setIsRequestingLocation(false);
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
    setSelectedServices(availableDapperServices(offeredServices));
    setIsPreferencesOpen(true);
    preferencesProgress.setValue(0);
    Animated.timing(preferencesProgress, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }

  function closePreferences() {
    setPendingModeAfterPreferences(null);
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

  async function loadProfileRatings() {
    setIsLoadingRatings(true);
    setRatingsError(null);
    try {
      const response = await fetchDapperRatings(token);
      if (isMountedRef.current) {
        setRatingsData(response);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        setRatingsError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load ratings.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingRatings(false);
      }
    }
  }

  function openProfile() {
    setIsMenuOpen(false);
    setProfileName(name ?? '');
    setProfileUsername(username ?? '');
    setCurrentPassword('');
    setIsPasswordModalOpen(false);
    setPasswordCurrent('');
    setPasswordNew('');
    setPasswordConfirm('');
    setPasswordError(null);
    setPasswordSuccess(null);
    setProfileError(null);
    setProfileSuccess(null);
    setIsProfileOpen(true);
    profileProgress.setValue(0);
    Animated.timing(profileProgress, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
    void loadProfileRatings();
  }

  function closeProfile() {
    if (isSavingProfile || isUpdatingPassword) {
      return;
    }
    if (isPasswordModalOpen) {
      closePasswordModal();
    }
    Animated.timing(profileProgress, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsProfileOpen(false);
      }
    });
  }

  function openPasswordModal() {
    setPasswordCurrent('');
    setPasswordNew('');
    setPasswordConfirm('');
    setPasswordError(null);
    setPasswordSuccess(null);
    setIsPasswordModalOpen(true);
    passwordSheetProgress.setValue(0);
    Animated.timing(passwordSheetProgress, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }

  function closePasswordModal() {
    if (isUpdatingPassword) {
      return;
    }
    Animated.timing(passwordSheetProgress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsPasswordModalOpen(false);
        setPasswordCurrent('');
        setPasswordNew('');
        setPasswordConfirm('');
        setPasswordError(null);
        setPasswordSuccess(null);
      }
    });
  }

  function closeAllProfile() {
    closePasswordModal();
    closeProfile();
  }

  async function handleUpdatePassword() {
    if (isUpdatingPassword) {
      return;
    }

    setPasswordError(null);
    setPasswordSuccess(null);

    if (!passwordCurrent) {
      setPasswordError('Enter your current password.');
      return;
    }

    if (passwordNew.length < 8 || passwordNew.length > 128) {
      setPasswordError('New password must be between 8 and 128 characters.');
      return;
    }

    if (passwordNew !== passwordConfirm) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (passwordNew === passwordCurrent) {
      setPasswordError(
        'New password must be different from your current password.',
      );
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const result = await onUpdateProfile({
        currentPassword: passwordCurrent,
        newPassword: passwordNew,
      });
      if (!isMountedRef.current) {
        return;
      }
      if (!result.ok) {
        setPasswordError(result.error);
        return;
      }
      setPasswordCurrent('');
      setPasswordNew('');
      setPasswordConfirm('');
      setPasswordSuccess('Password updated securely.');
      setTimeout(() => {
        if (isMountedRef.current) {
          closePasswordModal();
        }
      }, 1200);
    } finally {
      if (isMountedRef.current) {
        setIsUpdatingPassword(false);
      }
    }
  }

  async function handleSaveProfile() {
    if (isSavingProfile) {
      return;
    }

    const trimmedName = profileName.trim();
    const normalizedUsername = profileUsername.trim().toLowerCase();
    const existingName = name ?? '';
    const existingUsername = (username ?? '').toLowerCase();
    const isUsernameChanged = normalizedUsername !== existingUsername;
    const isNameChanged = trimmedName !== existingName;

    setProfileError(null);
    setProfileSuccess(null);

    if (trimmedName.length > 60) {
      setProfileError('Name must be 60 characters or fewer.');
      return;
    }

    if (!/^[a-z0-9_-]{3,30}$/.test(normalizedUsername)) {
      setProfileError(
        'Username must be 3-30 letters, numbers, underscores, or hyphens.',
      );
      return;
    }

    if (!isNameChanged && !isUsernameChanged) {
      setProfileError('No changes to save.');
      return;
    }

    if (isUsernameChanged && authProvider === 'local' && !currentPassword) {
      setProfileError('Enter your current password to change your username.');
      return;
    }

    const payload: ProfileUpdatePayload = {};
    if (isNameChanged) {
      payload.name = trimmedName.length > 0 ? trimmedName : null;
    }
    if (isUsernameChanged) {
      payload.username = normalizedUsername;
    }
    if (currentPassword) {
      payload.currentPassword = currentPassword;
    }

    setIsSavingProfile(true);
    try {
      const result = await onUpdateProfile(payload);
      if (!isMountedRef.current) {
        return;
      }
      if (!result.ok) {
        setProfileError(result.error);
        return;
      }
      setCurrentPassword('');
      setProfileSuccess('Profile updated securely.');
    } finally {
      if (isMountedRef.current) {
        setIsSavingProfile(false);
      }
    }
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

    const modeAfterSave = pendingModeAfterPreferences;
    if (await onSaveDapperPreferences(selectedServices)) {
      closePreferences();
      if (modeAfterSave) {
        handleSelectMode(modeAfterSave, true);
      }
    }
  }

  function selectMapMode(nextMode: AppMode) {
    if (nextMode === 'dapper' && offeredServices.length === 0) {
      requestLocationRequestIdRef.current += 1;
      setIsRequestingLocation(false);
      setPendingModeAfterPreferences(nextMode);
      openPreferences();
      return;
    }

    handleSelectMode(nextMode);
  }

  async function confirmRequest() {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    setShowMatchToast(false);
    setRequestLocationError(null);
    setSelectedCrispinessRating(null);
    setRatingComment('');
    setRatingSubmitted(false);
    setRatingError(null);

    if (orderLocationMode === 'custom' && customOrderLocation) {
      void dapRequest.startRequest(selectedDap, customOrderLocation, {
        useLiveLocation: false,
      });
      return;
    }

    const requestId = ++requestLocationRequestIdRef.current;
    setIsRequestingLocation(true);

    try {
      const result =
        Platform.OS === 'web'
          ? await resolveWebDapperOnlineLocation()
          : await resolveDapperOnlineLocation(
              {
                hasServicesEnabledAsync: () =>
                  Location.hasServicesEnabledAsync(),
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

      if (
        !isMountedRef.current ||
        activeModeRef.current !== 'order' ||
        requestLocationRequestIdRef.current !== requestId
      ) {
        return;
      }

      if (!result.ok) {
        setRequestLocationError(
          result.reason === 'permission-denied' ||
            result.reason === 'services-disabled'
            ? 'Location is off. Enable location or search/pinpoint a location on the map.'
            : 'Unable to get your location. Try again or set a location on the map.',
        );
        return;
      }

      setLocation(result.coordinates);
      setLocationTrackingRevision((revision) => revision + 1);
      void dapRequest.startRequest(selectedDap, result.coordinates, {
        useLiveLocation: true,
      });
    } catch {
      if (
        isMountedRef.current &&
        requestLocationRequestIdRef.current === requestId
      ) {
        setRequestLocationError(
          'Unable to get your location. Check location services or set a location on the map.',
        );
      }
    } finally {
      if (
        isMountedRef.current &&
        requestLocationRequestIdRef.current === requestId
      ) {
        setIsRequestingLocation(false);
      }
    }
  }

  function handleSelectSearchResult(result: LocationSearchResult) {
    setOrderLocationMode('custom');
    setCustomOrderLocation(result.coordinates);
    setCustomOrderLabel(result.label);
    setRequestLocationError(null);
    setSearchError(null);
    setIsSearchBoxOpen(false);
    setIsPinpointNoticeVisible(false);
  }

  function handlePinOrderLocation(coordinates: Coordinates) {
    if (
      isDapperMode ||
      requestInProgress ||
      isRequestMenuOpen ||
      isPreferencesOpen ||
      isProfileOpen
    ) {
      return;
    }

    setIsMenuOpen(false);
    setIsSearchBoxOpen(false);
    setIsPinpointNoticeVisible(false);
    setOrderLocationMode('custom');
    setCustomOrderLocation(coordinates);
    setCustomOrderLabel(
      `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
    );
    setRequestLocationError(null);
    setSearchError(null);

    const geocodeId = ++reverseGeocodeIdRef.current;
    void reverseGeocodeLocation(coordinates).then((label) => {
      if (
        label &&
        isMountedRef.current &&
        reverseGeocodeIdRef.current === geocodeId
      ) {
        setCustomOrderLabel(label);
      }
    });
  }

  async function handleUseCurrentLocation() {
    if (isLocatingCurrent) {
      return;
    }

    setSearchError(null);
    setIsLocatingCurrent(true);

    try {
      const result =
        Platform.OS === 'web'
          ? await resolveWebDapperOnlineLocation()
          : await resolveDapperOnlineLocation(
              {
                hasServicesEnabledAsync: () =>
                  Location.hasServicesEnabledAsync(),
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

      if (!isMountedRef.current || activeModeRef.current !== 'order') {
        return;
      }

      if (!result.ok) {
        setSearchError(
          result.reason === 'permission-denied' ||
            result.reason === 'services-disabled'
            ? 'Location is disabled. Enable location or search/pinpoint a spot instead.'
            : 'Unable to get your current location.',
        );
        return;
      }

      setLocation(result.coordinates);
      setOrderLocationMode('current');
      setCustomOrderLocation(null);
      setCustomOrderLabel(null);
      setRequestLocationError(null);
      setIsSearchBoxOpen(false);
      setIsPinpointNoticeVisible(false);
      setLocationTrackingRevision((revision) => revision + 1);
    } catch {
      if (isMountedRef.current) {
        setSearchError('Unable to read your current location.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLocatingCurrent(false);
      }
    }
  }

  function handleClearPinnedLocation() {
    setOrderLocationMode('current');
    setCustomOrderLocation(null);
    setCustomOrderLabel(null);
    setRequestLocationError(null);
    setIsPinpointNoticeVisible(false);
  }

  async function submitCrispinessRating() {
    if (
      dapRequest.requestId === null ||
      selectedCrispinessRating === null ||
      isSubmittingRating
    ) {
      return;
    }

    setIsSubmittingRating(true);
    setRatingError(null);
    try {
      await submitDapRating(
        token,
        dapRequest.requestId,
        selectedCrispinessRating,
        ratingComment,
      );
      setRatingSubmitted(true);
    } catch (submitError) {
      setRatingError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to save your rating.',
      );
    } finally {
      setIsSubmittingRating(false);
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

  const displayRatingAverage =
    ratingsData?.averageRating ?? crispinessRating ?? null;
  const displayRatingCount =
    ratingsData?.totalRatings ?? crispinessRatingCount ?? 0;
  const isUsernameChanged =
    profileUsername.trim().toLowerCase() !== (username ?? '').toLowerCase();

  function renderDapperRatingsSection() {
    return (
      <View style={styles.ratingsSection}>
        <View style={styles.ratingsHeaderRow}>
          <View style={styles.ratingsTitleGroup}>
            <Text style={styles.sectionTitle}>Dapper Crispiness Rating</Text>
            <View style={styles.modeTag}>
              <Text style={styles.modeTagText}>
                {isDapperMode ? 'Dapper Mode' : 'Dapper Stats'}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={isLoadingRatings}
            onPress={() => void loadProfileRatings()}
            hitSlop={8}
          >
            <Text style={styles.refreshLink}>
              {isLoadingRatings ? 'Loading...' : 'Refresh'}
            </Text>
          </Pressable>
        </View>

        {ratingsError ? (
          <Text style={styles.profileErrorText}>{ratingsError}</Text>
        ) : null}

        <View style={styles.ratingOverviewCard}>
          <View style={styles.ratingScoreColumn}>
            <Text style={styles.ratingBigNumber}>
              {displayRatingCount > 0 && displayRatingAverage !== null
                ? displayRatingAverage.toFixed(1)
                : '—'}
            </Text>
            <Text style={styles.ratingStarsText}>
              {displayRatingCount > 0 && displayRatingAverage !== null
                ? formatStarGlyphs(displayRatingAverage)
                : '☆☆☆☆☆'}
            </Text>
            <Text style={styles.ratingCountLabel}>
              {displayRatingCount === 0
                ? 'No ratings yet'
                : `${displayRatingCount} ${displayRatingCount === 1 ? 'rating' : 'ratings'}`}
            </Text>
          </View>

          <View style={styles.ratingBreakdownColumn}>
            {(['5', '4', '3', '2', '1'] as const).map((starKey) => {
              const count = ratingsData?.breakdown[starKey] ?? 0;
              const pct =
                displayRatingCount > 0
                  ? Math.round((count / displayRatingCount) * 100)
                  : 0;
              return (
                <View key={starKey} style={styles.breakdownRow}>
                  <Text style={styles.breakdownStarLabel}>{starKey}★</Text>
                  <View style={styles.breakdownTrack}>
                    <View
                      style={[styles.breakdownFill, { width: `${pct}%` }]}
                    />
                  </View>
                  <Text style={styles.breakdownCount}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {isLoadingRatings && !ratingsData ? (
          <View style={styles.ratingsLoadingRow}>
            <ActivityIndicator color="#000000" size="small" />
            <Text style={styles.ratingsEmptyText}>Loading ratings...</Text>
          </View>
        ) : ratingsData && ratingsData.recentRatings.length > 0 ? (
          <View style={styles.recentRatingsList}>
            <Text style={styles.recentRatingsHeading}>Recent Ratings</Text>
            {ratingsData.recentRatings.map((item) => (
              <View key={item.id} style={styles.recentRatingCard}>
                <View style={styles.recentRatingTop}>
                  <View style={styles.recentRatingMeta}>
                    <Text style={styles.recentRaterName}>{item.raterName}</Text>
                    {item.service ? (
                      <View style={styles.serviceChip}>
                        <Text style={styles.serviceChipText}>
                          {item.service}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.recentRatingScore}>
                    {'★'.repeat(item.rating)}
                    {'☆'.repeat(5 - item.rating)}
                  </Text>
                </View>
                {item.comment ? (
                  <Text style={styles.recentRatingComment}>
                    “{item.comment}”
                  </Text>
                ) : null}
                <Text style={styles.recentRatingDate}>
                  {formatRatingDate(item.ratedAt)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.ratingsEmptyText}>
            Complete daps in Dapper mode to earn crispiness ratings from riders.
          </Text>
        )}
      </View>
    );
  }
  const canPinOrderLocation =
    !isDapperMode &&
    !requestInProgress &&
    !isRequestMenuOpen &&
    !isPreferencesOpen &&
    !isProfileOpen &&
    !isMenuOpen;
  const showOrderSearchBox =
    !isDapperMode &&
    !requestInProgress &&
    !isRequestMenuOpen &&
    !isPreferencesOpen &&
    !isProfileOpen;
  const orderLocationSummary =
    orderLocationMode === 'custom' && customOrderLabel
      ? customOrderLabel
      : location
        ? 'Current location'
        : 'Set dap location';

  return (
    <View style={styles.container}>
      <View style={styles.mapLayer}>
        <MapSurface
          canPinLocation={canPinOrderLocation}
          ownLocation={ownMapLocation}
          counterpartLocation={counterpartMapLocation}
          isSheetOpen={isRequestMenuOpen || isDapperSheetOpen}
          mode={activeMode}
          onSelectLocation={handlePinOrderLocation}
        />
      </View>

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
                    isChangingMode ||
                    isSavingPreferences ||
                    requestInProgress ||
                    activeDap !== null
                  }
                  onPress={() => selectMapMode(tab.mode)}
                  style={[
                    styles.modeTab,
                    isSelected && styles.modeTabSelected,
                    (isSubmitting ||
                      isChangingMode ||
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
                {name || steamUsername || stravaUsername || username ? (
                  <View style={styles.menuAccountHeader}>
                    {(steamAvatar || stravaAvatar) && !avatarLoadFailed ? (
                      <Image
                        onError={() => setAvatarLoadFailed(true)}
                        source={{ uri: steamAvatar || stravaAvatar || undefined }}
                        style={styles.menuAvatar}
                      />
                    ) : null}
                    <View style={styles.menuAccountText}>
                      <Text numberOfLines={1} style={styles.menuUsername}>
                        {name || steamUsername || stravaUsername || username}
                      </Text>
                      {name && username ? (
                        <Text numberOfLines={1} style={styles.menuSubUsername}>
                          @{username}
                        </Text>
                      ) : null}
                      {authProvider !== 'local' ? (
                        <Text style={styles.menuProviderBadge}>
                          {authProvider === 'strava' ? 'Strava' : 'Steam'}
                        </Text>
                      ) : null}
                      {isDapperMode || crispinessRatingCount > 0 ? (
                        <Text style={styles.menuRatingBadge}>
                          {crispinessRatingCount > 0 && crispinessRating !== null
                            ? `★ ${crispinessRating.toFixed(1)} (${crispinessRatingCount})`
                            : '★ New Dapper'}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                {error ? <Text style={styles.accountError}>{error}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting || isSavingPreferences || isSavingProfile}
                  onPress={openProfile}
                  style={styles.menuItem}
                >
                  <Text style={styles.preferencesMenuText}>Profile Settings</Text>
                </Pressable>
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

        {error &&
        !isMenuOpen &&
        !isPreferencesOpen &&
        !isProfileOpen &&
        !isPasswordModalOpen &&
        !isDeleteModalOpen ? (
          <Text style={styles.modeError}>{error}</Text>
        ) : null}
        {locationTrackingError ? (
          <Text style={styles.locationTrackingError}>
            {locationTrackingError}
          </Text>
        ) : null}

        {showOrderSearchBox ? (
          <View pointerEvents="box-none" style={styles.searchContainer}>
            {isSearchBoxOpen ? (
              <View style={styles.searchCard}>
                <View style={styles.searchCardHeader}>
                  <Text style={styles.searchCardTitle}>Set dap location</Text>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      setIsSearchBoxOpen(false);
                      setSearchError(null);
                    }}
                  >
                    <Text style={styles.searchCloseText}>Close</Text>
                  </Pressable>
                </View>

                <View style={styles.searchInputRow}>
                  <View style={styles.uberPinSquare} />
                  <TextInput
                    ref={searchInputRef}
                    autoCorrect={false}
                    onChangeText={(text) => {
                      setSearchQuery(text);
                      setSearchError(null);
                    }}
                    placeholder="Search address or place"
                    placeholderTextColor="#777777"
                    returnKeyType="search"
                    style={styles.searchInput}
                    value={searchQuery}
                  />
                  {isSearchingLocations ? (
                    <ActivityIndicator color="#000000" size="small" />
                  ) : searchQuery.length > 0 ? (
                    <Pressable
                      accessibilityLabel="Clear search"
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        setSearchError(null);
                      }}
                    >
                      <Text style={styles.searchClearGlyph}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.searchOptionsList}>
                  <View
                    style={[
                      styles.searchOptionRow,
                      orderLocationMode === 'custom' &&
                        styles.searchOptionRowActive,
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setSearchError(null);
                        searchInputRef.current?.focus();
                      }}
                      style={styles.searchOptionMainPressable}
                    >
                      <View style={styles.searchOptionIconBox}>
                        <View style={styles.uberPinSquare} />
                      </View>
                      <View style={styles.searchOptionTextCol}>
                        <Text style={styles.searchOptionTitle}>
                          Set location by searching
                        </Text>
                        <Text style={styles.searchOptionSubtitle}>
                          Type a place above or pin directly on the map
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={6}
                      onPress={() => {
                        setIsSearchBoxOpen(false);
                        setIsPinpointNoticeVisible(true);
                      }}
                      style={styles.pinMapChip}
                    >
                      <Text style={styles.pinMapChipText}>Pin map</Text>
                    </Pressable>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    disabled={isLocatingCurrent}
                    onPress={() => void handleUseCurrentLocation()}
                    style={[
                      styles.searchOptionRow,
                      orderLocationMode === 'current' &&
                        location !== null &&
                        styles.searchOptionRowActive,
                    ]}
                  >
                    <View style={styles.searchOptionIconCircle}>
                      {isLocatingCurrent ? (
                        <ActivityIndicator color="#000000" size="small" />
                      ) : (
                        <View style={styles.currentLocationDot} />
                      )}
                    </View>
                    <View style={styles.searchOptionTextCol}>
                      <Text style={styles.searchOptionTitle}>
                        Use current location
                      </Text>
                      <Text style={styles.searchOptionSubtitle}>
                        {location
                          ? 'Follow your live device GPS'
                          : 'Enable GPS to center on you'}
                      </Text>
                    </View>
                  </Pressable>
                </View>

                {searchError ? (
                  <Text style={styles.searchErrorText}>{searchError}</Text>
                ) : null}

                {searchResults.length > 0 ? (
                  <ScrollView
                    bounces={false}
                    keyboardShouldPersistTaps="handled"
                    style={styles.searchResultsScroll}
                  >
                    {searchResults.map((result) => (
                      <Pressable
                        key={result.id}
                        accessibilityRole="button"
                        onPress={() => handleSelectSearchResult(result)}
                        style={styles.searchResultRow}
                      >
                        <View style={styles.searchResultPin} />
                        <View style={styles.searchResultTextCol}>
                          <Text numberOfLines={1} style={styles.searchResultTitle}>
                            {result.title}
                          </Text>
                          {result.subtitle ? (
                            <Text
                              numberOfLines={1}
                              style={styles.searchResultSubtitle}
                            >
                              {result.subtitle}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : searchQuery.trim().length >= 2 &&
                  !isSearchingLocations &&
                  !searchError ? (
                  <Text style={styles.searchEmptyText}>
                    No places found. Try another search or tap Pin map.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.searchBarRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setIsMenuOpen(false);
                    setIsPinpointNoticeVisible(false);
                    setIsSearchBoxOpen(true);
                    setTimeout(() => searchInputRef.current?.focus(), 60);
                  }}
                  style={styles.searchBarPill}
                >
                  <View
                    style={
                      orderLocationMode === 'custom'
                        ? styles.uberPinSquare
                        : styles.currentLocationDot
                    }
                  />
                  <Text numberOfLines={1} style={styles.searchBarText}>
                    {orderLocationSummary}
                  </Text>
                  <View style={styles.searchBarBadge}>
                    <Text style={styles.searchBarBadgeText}>
                      {orderLocationMode === 'custom' ? 'Pinned' : 'Search'}
                    </Text>
                  </View>
                </Pressable>
                {orderLocationMode === 'custom' ? (
                  <Pressable
                    accessibilityLabel="Clear pinned location"
                    accessibilityRole="button"
                    onPress={handleClearPinnedLocation}
                    style={styles.clearPinPill}
                  >
                    <Text style={styles.clearPinText}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {isPinpointNoticeVisible && !isSearchBoxOpen ? (
              <View style={styles.pinHintPill}>
                <Text style={styles.pinHintText}>
                  Tap anywhere on the map to drop your pin
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.bottomActions}>
          {isDapperMode ? (
            <Text style={styles.dapperStatus}>
              {activeDap
                ? 'You are busy with an active UberDap.'
                : offeredServices.length === 0
                  ? 'Select at least one service in Preferences to go online.'
                  : isDapperOnline
                    ? 'Your location is being shared while you are online.'
                    : 'Your location stays private while you are offline.'}
            </Text>
          ) : null}
          {isDapperMode && connectionError ? (
            <View style={styles.onlineBadge}>
              <Text style={styles.accountError}>{connectionError}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={
              isSubmitting ||
              (isDapperMode && (isGoingOnline || isConnecting)) ||
              (!isDapperMode &&
                (dapRequest.isRestoring || isRequestingLocation))
            }
            onPress={() => {
              if (isDapperMode) {
                if (isDapperOnline) {
                  handleGoOffline();
                } else {
                  void handleGoOnline();
                }
                return;
              }

              if (dapRequest.status === 'delivered') {
                dapRequest.resetRequest();
              }
              openRequestMenu();
            }}
            style={[
              styles.requestButton,
              isDapperMode && styles.goOnlineButton,
              isDapperMode && isDapperOnline && styles.goOfflineButton,
              (isSubmitting ||
                (isDapperMode && (isGoingOnline || isConnecting)) ||
                (!isDapperMode &&
                  (dapRequest.isRestoring || isRequestingLocation))) &&
                styles.disabledButton,
            ]}
          >
            {isDapperMode && (isGoingOnline || isConnecting) ? (
              <ActivityIndicator color="#ffffff" />
            ) : !isDapperMode &&
              (isRequestingLocation || dapRequest.isRestoring) ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.requestButtonText}>
                {isDapperMode
                  ? offeredServices.length === 0
                    ? 'Choose Services'
                    : isDapperOnline
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
                height: requestSheetHeight,
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {dapRequest.status === 'matched'
                  ? isDapCompletedLocally
                    ? 'UberDap delivered'
                    : 'Your UberDap'
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
                <View style={styles.sheetLocationRow}>
                  <View style={styles.sheetLocationLeft}>
                    <View
                      style={
                        orderLocationMode === 'custom'
                          ? styles.uberPinSquare
                          : styles.currentLocationDot
                      }
                    />
                    <Text numberOfLines={1} style={styles.sheetLocationText}>
                      {orderLocationMode === 'custom' && customOrderLabel
                        ? customOrderLabel
                        : location
                          ? 'Using current location'
                          : 'Current location (or set on map)'}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={6}
                    onPress={() => {
                      closeRequestMenu();
                      setIsSearchBoxOpen(true);
                    }}
                  >
                    <Text style={styles.sheetLocationChangeText}>Change</Text>
                  </Pressable>
                </View>
                {requestLocationError || dapRequest.error ? (
                  <Text style={styles.matchingError}>
                    {requestLocationError ?? dapRequest.error}
                  </Text>
                ) : null}
                <ScrollView
                  contentContainerStyle={styles.options}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  style={[
                    styles.optionListScroll,
                    { maxHeight: Math.max(48, sheetHeight - 180) },
                  ]}
                >
                  {dapOptions.map((option) => {
                    const isSelected = selectedDap === option;
                    const details = DAP_DETAILS[option];

                    return (
                      <Pressable
                        accessibilityLabel={option}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: isSelected }}
                        key={option}
                        onPress={() => setSelectedDap(option)}
                        style={({ pressed }) => [
                          styles.optionButton,
                          isSelected && styles.optionButtonSelected,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <View style={styles.optionLeft}>
                          <View style={styles.optionTitleRow}>
                            <Text style={styles.optionTitle}>{option}</Text>
                            <View
                              style={[
                                styles.tierBadge,
                                isSelected
                                  ? styles.tierBadgeSelected
                                  : styles.tierBadgeDefault,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.tierBadgeText,
                                  isSelected
                                    ? styles.tierBadgeTextSelected
                                    : styles.tierBadgeTextDefault,
                                ]}
                              >
                                {details.tag}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.optionDescription}>
                            {details.description}
                          </Text>
                        </View>
                        <View style={styles.optionRight}>
                          <Text style={styles.optionPrice}>
                            {dapOptionPrices[option]}
                          </Text>
                          <Text style={styles.optionTime}>{details.time}</Text>
                          <View
                            style={[
                              styles.radio,
                              isSelected && styles.radioSelected,
                            ]}
                          >
                            {isSelected ? <View style={styles.radioDot} /> : null}
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  accessibilityRole="button"
                  disabled={isRequestingLocation || dapRequest.isRestoring}
                  onPress={() => void confirmRequest()}
                  style={[
                    styles.confirmButton,
                    (isRequestingLocation || dapRequest.isRestoring) &&
                      styles.disabledButton,
                  ]}
                >
                  {isRequestingLocation ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>
                      Confirm {selectedDap}
                    </Text>
                  )}
                </Pressable>
              </>
            ) : dapRequest.status === 'connecting' ||
              dapRequest.status === 'searching' ? (
              <View style={styles.matchingContent}>
                <ActivityIndicator color="#000000" size="large" />
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
            ) : dapRequest.status === 'matched' && !isDapCompletedLocally ? (
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.matchedScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <DapDecibelMeasurer
                  dapperName={
                    dapRequest.matchedDapper?.name ||
                    dapRequest.matchedDapper?.username
                  }
                  dapperRating={dapRequest.matchedDapper?.crispinessRating}
                  dapperRatingCount={
                    dapRequest.matchedDapper?.crispinessRatingCount
                  }
                  dapperUsername={dapRequest.matchedDapper?.username}
                  onProceedToRating={() => setIsDapCompletedLocally(true)}
                  targetDb={85}
                />
              </ScrollView>
            ) : (
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.deliveredScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.matchSuccessText}>
                  Your UberDap has been delivered.
                </Text>
                {ratingSubmitted ? (
                  <Text style={styles.ratingThanks}>
                    Thanks for rating this dap!
                  </Text>
                ) : (
                  <>
                    <Text style={styles.ratingPrompt}>
                      Rate the crispiness of your dap
                    </Text>
                    <View style={styles.ratingOptions}>
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <Pressable
                          key={rating}
                          accessibilityLabel={`${rating} out of 5`}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: selectedCrispinessRating === rating,
                          }}
                          disabled={isSubmittingRating}
                          onPress={() => setSelectedCrispinessRating(rating)}
                          style={[
                            styles.ratingOption,
                            selectedCrispinessRating === rating &&
                              styles.ratingOptionSelected,
                            isSubmittingRating && styles.disabledButton,
                          ]}
                        >
                          <Text
                            style={[
                              styles.ratingOptionText,
                              selectedCrispinessRating === rating &&
                                styles.ratingOptionTextSelected,
                            ]}
                          >
                            ★ {rating}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {selectedCrispinessRating !== null ? (
                      <Text style={styles.ratingDescriptor}>
                        {CRISPINESS_LABELS[selectedCrispinessRating]}
                      </Text>
                    ) : null}
                    <TextInput
                      editable={!isSubmittingRating}
                      maxLength={240}
                      onChangeText={setRatingComment}
                      placeholder="Add a quick note (optional)"
                      placeholderTextColor="#888888"
                      style={styles.ratingCommentInput}
                      value={ratingComment}
                    />
                    {ratingError ? (
                      <Text style={styles.ratingError}>{ratingError}</Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={
                        selectedCrispinessRating === null || isSubmittingRating
                      }
                      onPress={() => void submitCrispinessRating()}
                      style={[
                        styles.confirmButton,
                        styles.fullWidthButton,
                        (selectedCrispinessRating === null ||
                          isSubmittingRating) &&
                          styles.disabledButton,
                      ]}
                    >
                      {isSubmittingRating ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <Text style={styles.confirmButtonText}>
                          Submit Rating
                        </Text>
                      )}
                    </Pressable>
                  </>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={dapRequest.resetRequest}
                  style={styles.requestAnotherButton}
                >
                  <Text style={styles.requestAnotherButtonText}>
                    Request another UberDap
                  </Text>
                </Pressable>
              </ScrollView>
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
            <ScrollView
              contentContainerStyle={styles.options}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              style={[
                styles.optionListScroll,
                { maxHeight: Math.max(48, sheetHeight - 225) },
              ]}
            >
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
            </ScrollView>
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

        {isProfileOpen ? (
          <Animated.View
            style={[
              styles.profileSheet,
              {
                height: profileSheetHeight,
                transform: [{ translateY: profileTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Profile Settings</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isSavingProfile}
                onPress={closeProfile}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.profileScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {isDapperMode ? renderDapperRatingsSection() : null}

              <View style={styles.profileFormSection}>
                <View style={styles.profileFormHeader}>
                  <Text style={styles.sectionTitle}>Account & Security</Text>
                  <View style={styles.securityBadge}>
                    <Text style={styles.securityBadgeText}>
                      {authProvider !== 'local'
                        ? `${authProvider === 'strava' ? 'Strava' : 'Steam'} SSO`
                        : 'Encrypted Auth'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Name</Text>
                <TextInput
                  editable={!isSavingProfile}
                  maxLength={60}
                  onChangeText={(text) => {
                    setProfileName(text);
                    setProfileError(null);
                    setProfileSuccess(null);
                  }}
                  placeholder="Your display name"
                  placeholderTextColor="#888888"
                  style={styles.profileInput}
                  value={profileName}
                />

                <Text style={styles.inputLabel}>Username</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSavingProfile}
                  maxLength={30}
                  onChangeText={(text) => {
                    setProfileUsername(text);
                    setProfileError(null);
                    setProfileSuccess(null);
                  }}
                  placeholder="username"
                  placeholderTextColor="#888888"
                  style={styles.profileInput}
                  value={profileUsername}
                />

                {isUsernameChanged && authProvider === 'local' ? (
                  <>
                    <Text style={styles.inputLabel}>Current Password</Text>
                    <TextInput
                      autoComplete="current-password"
                      editable={!isSavingProfile}
                      onChangeText={(text) => {
                        setCurrentPassword(text);
                        setProfileError(null);
                        setProfileSuccess(null);
                      }}
                      placeholder="Required to confirm username change"
                      placeholderTextColor="#888888"
                      secureTextEntry
                      style={styles.profileInput}
                      value={currentPassword}
                    />
                  </>
                ) : null}

                {profileError ? (
                  <Text style={styles.profileErrorText}>{profileError}</Text>
                ) : null}
                {profileSuccess ? (
                  <Text style={styles.profileSuccessText}>
                    {profileSuccess}
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={isSavingProfile}
                  onPress={() => void handleSaveProfile()}
                  style={[
                    styles.confirmButton,
                    isSavingProfile && styles.disabledButton,
                  ]}
                >
                  {isSavingProfile ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>Save Profile</Text>
                  )}
                </Pressable>

                {authProvider !== 'local' ? (
                  <Text style={styles.steamSecurityNote}>
                    Signed in with {authProvider === 'strava' ? 'Strava' : 'Steam'}. Password changes are managed by your provider.
                  </Text>
                ) : (
                  <View style={styles.changePasswordSection}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={openPasswordModal}
                      style={({ pressed }) => [
                        styles.changePasswordCard,
                        pressed && styles.changePasswordCardPressed,
                      ]}
                    >
                      <View style={styles.changePasswordCardContent}>
                        <Text style={styles.changePasswordCardTitle}>
                          Change Password
                        </Text>
                        <Text style={styles.changePasswordCardSubtitle}>
                          Update your account password
                        </Text>
                      </View>
                      <View style={styles.changePasswordArrowContainer}>
                        <Text style={styles.changePasswordArrow}>→</Text>
                      </View>
                    </Pressable>
                  </View>
                )}

                <View style={styles.deleteDangerSection}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSubmitting}
                    onPress={openDeleteModal}
                    style={({ pressed }) => [
                      styles.deleteAccountCard,
                      pressed && styles.deleteAccountCardPressed,
                    ]}
                  >
                    <View style={styles.changePasswordCardContent}>
                      <Text style={styles.deleteAccountCardTitle}>
                        Delete Account
                      </Text>
                      <Text style={styles.deleteAccountCardSubtitle}>
                        Permanently remove your account and all reviews
                      </Text>
                    </View>
                    <View style={styles.deleteAccountArrowContainer}>
                      <Text style={styles.deleteAccountArrow}>→</Text>
                    </View>
                  </Pressable>
                </View>
              </View>

              {!isDapperMode ? renderDapperRatingsSection() : null}
            </ScrollView>
          </Animated.View>
        ) : null}

        {isPasswordModalOpen ? (
          <Animated.View
            style={[
              styles.passwordModalBackdrop,
              {
                opacity: passwordSheetProgress,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="Dismiss change password sheet"
              onPress={closePasswordModal}
              style={StyleSheet.absoluteFill}
            />
            <Animated.View
              style={[
                styles.passwordSheet,
                {
                  height: passwordSheetHeight,
                  transform: [{ translateY: passwordSheetTranslateY }],
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isUpdatingPassword}
                  onPress={closePasswordModal}
                  style={styles.sheetCloseButton}
                >
                  <Text style={styles.sheetCloseText}>← Back</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>Change Password</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isUpdatingPassword}
                  onPress={closeAllProfile}
                  style={styles.sheetCloseButton}
                >
                  <Text style={styles.sheetCloseText}>Close</Text>
                </Pressable>
              </View>

              <ScrollView
                bounces={false}
                contentContainerStyle={styles.passwordScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.passwordSubtitle}>
                  Enter your current password and choose a new password (min. 8 characters).
                </Text>

                <Text style={styles.inputLabel}>Current Password</Text>
                <TextInput
                  autoComplete="current-password"
                  editable={!isUpdatingPassword}
                  onChangeText={(text) => {
                    setPasswordCurrent(text);
                    setPasswordError(null);
                    setPasswordSuccess(null);
                  }}
                  placeholder="Enter current password"
                  placeholderTextColor="#888888"
                  secureTextEntry
                  style={styles.profileInput}
                  value={passwordCurrent}
                />

                <Text style={styles.inputLabel}>New Password</Text>
                <TextInput
                  autoComplete="new-password"
                  editable={!isUpdatingPassword}
                  onChangeText={(text) => {
                    setPasswordNew(text);
                    setPasswordError(null);
                    setPasswordSuccess(null);
                  }}
                  placeholder="At least 8 characters"
                  placeholderTextColor="#888888"
                  secureTextEntry
                  style={styles.profileInput}
                  value={passwordNew}
                />

                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                  autoComplete="new-password"
                  editable={!isUpdatingPassword}
                  onChangeText={(text) => {
                    setPasswordConfirm(text);
                    setPasswordError(null);
                    setPasswordSuccess(null);
                  }}
                  placeholder="Re-enter new password"
                  placeholderTextColor="#888888"
                  secureTextEntry
                  style={styles.profileInput}
                  value={passwordConfirm}
                />

                {passwordError ? (
                  <Text style={styles.profileErrorText}>{passwordError}</Text>
                ) : null}
                {passwordSuccess ? (
                  <Text style={styles.profileSuccessText}>
                    {passwordSuccess}
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={isUpdatingPassword}
                  onPress={() => void handleUpdatePassword()}
                  style={[
                    styles.confirmButton,
                    isUpdatingPassword && styles.disabledButton,
                  ]}
                >
                  {isUpdatingPassword ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>Update Password</Text>
                  )}
                </Pressable>
              </ScrollView>
            </Animated.View>
          </Animated.View>
        ) : null}

        {isDeleteModalOpen ? (
          <Animated.View
            style={[
              styles.passwordModalBackdrop,
              {
                opacity: deleteSheetProgress,
              },
            ]}
          >
            <Pressable
              accessibilityLabel="Dismiss delete account sheet"
              onPress={closeDeleteModal}
              style={StyleSheet.absoluteFill}
            />
            <Animated.View
              style={[
                styles.passwordSheet,
                {
                  height: deleteSheetHeight,
                  transform: [{ translateY: deleteSheetTranslateY }],
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={closeDeleteModal}
                  style={styles.sheetCloseButton}
                >
                  <Text style={styles.sheetCloseText}>Cancel</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>Delete Account</Text>
                <View style={styles.sheetCloseButton} />
              </View>

              <ScrollView
                bounces={false}
                contentContainerStyle={styles.passwordScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.deleteWarningBox}>
                  <Text style={styles.deleteWarningTitle}>
                    This action is permanent
                  </Text>
                  <Text style={styles.deleteWarningBody}>
                    Deleting your account will permanently erase your profile,
                    crispiness ratings, and all reviews you have given or
                    received.
                  </Text>
                </View>

                <Text style={styles.inputLabel}>
                  Type <Text style={styles.deleteKeyword}>DELETE</Text> to
                  confirm
                </Text>
                <TextInput
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  onChangeText={setDeleteConfirmText}
                  placeholder="DELETE"
                  placeholderTextColor="#888888"
                  style={styles.profileInput}
                  value={deleteConfirmText}
                />

                {error ? (
                  <Text style={styles.profileErrorText}>{error}</Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={
                    isSubmitting || deleteConfirmText.trim() !== 'DELETE'
                  }
                  onPress={confirmDeleteAccount}
                  style={[
                    styles.deleteConfirmButton,
                    (isSubmitting || deleteConfirmText.trim() !== 'DELETE') &&
                      styles.disabledButton,
                  ]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>
                      Delete Account Permanently
                    </Text>
                  )}
                </Pressable>
              </ScrollView>
            </Animated.View>
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
                {!isDapperOnline ? (
                  <Text style={styles.dapperSheetHint}>
                    Go online again to mark this dap delivered.
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={!isDapperOnline || isResponding}
                  onPress={markDapDelivered}
                  style={[
                    styles.deliveredButton,
                    (!isDapperOnline || isResponding) && styles.disabledButton,
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

function formatCrispinessStars(rating: number): string {
  const roundedRating = Math.max(0, Math.min(5, Math.round(rating * 10) / 10));
  return `${formatStarGlyphs(roundedRating)} · ${roundedRating.toFixed(1)} / 5.0`;
}

function formatStarGlyphs(rating: number): string {
  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  return `${'★'.repeat(rounded)}${'☆'.repeat(5 - rounded)}`;
}

function formatRatingDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function availableDapperServices(services: readonly DapService[]): DapService[] {
  return dapOptions.filter((service) => services.includes(service));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    backgroundColor: '#ffffff',
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  promptCard: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 22,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  promptTitle: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  promptMessage: {
    color: '#555555',
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
    backgroundColor: '#000000',
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
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ececec',
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
  },
  cancelButtonText: {
    color: '#555555',
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
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  modeTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  modeTabSelected: {
    backgroundColor: '#000000',
  },
  modeTabText: {
    color: '#666666',
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
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  menuAccountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
  },
  menuAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ececec',
  },
  menuAccountText: {
    flex: 1,
  },
  menuUsername: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  menuSubUsername: {
    color: '#6f7a90',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  menuProviderBadge: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  menuRatingBadge: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
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
    shadowColor: '#000000',
    shadowOpacity: 0.15,
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
    backgroundColor: '#000000',
  },
  menu: {
    position: 'absolute',
    top: 60,
    right: 0,
    width: 200,
    borderRadius: 14,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
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
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
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
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#000000',
  },
  onlineBadgeText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  requestButton: {
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  offlineButton: {
    backgroundColor: '#222222',
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
    color: '#555555',
    fontSize: 13,
    textAlign: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  goOnlineButton: {
    backgroundColor: '#000000',
  },
  goOfflineButton: {
    backgroundColor: '#222222',
  },
  accountError: {
    color: '#ee4d4d',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modeError: {
    position: 'absolute',
    top: 78,
    right: 16,
    left: 16,
    zIndex: 1102,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ee4d4d',
    backgroundColor: '#ffffff',
    fontSize: 13,
    textAlign: 'center',
    elevation: 4,
  },
  locationTrackingError: {
    position: 'absolute',
    top: 126,
    right: 16,
    left: 16,
    zIndex: 1101,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#ee4d4d',
    backgroundColor: '#ffffff',
    fontSize: 13,
    textAlign: 'center',
    elevation: 4,
  },
  disabledButton: {
    opacity: 0.6,
  },
  signOutText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteButton: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececec',
  },
  deleteText: {
    color: '#ee4d4d',
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
    shadowColor: '#000000',
    shadowOpacity: 0.15,
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
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
  },
  preferencesDescription: {
    color: '#666666',
    fontSize: 14,
    marginBottom: 14,
  },
  preferencesError: {
    color: '#ee4d4d',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    backgroundColor: '#f5f5f5',
  },
  sheetLocationLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetLocationText: {
    flex: 1,
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  sheetLocationChangeText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  searchContainer: {
    position: 'absolute',
    top: 78,
    right: 16,
    left: 16,
    zIndex: 1101,
    elevation: 11,
    gap: 8,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBarPill: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  searchBarText: {
    flex: 1,
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  searchBarBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#f1f1f1',
  },
  searchBarBadgeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  clearPinPill: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  clearPinText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  searchCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 9,
    gap: 10,
  },
  searchCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchCardTitle: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  searchCloseText: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '700',
  },
  searchInputRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f3f3f3',
  },
  searchInput: {
    flex: 1,
    height: 42,
    color: '#000000',
    fontSize: 15,
    fontWeight: '500',
  },
  searchClearGlyph: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  uberPinSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#000000',
  },
  currentLocationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#000000',
  },
  searchOptionsList: {
    gap: 8,
  },
  searchOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  searchOptionRowActive: {
    borderColor: '#000000',
    backgroundColor: '#fafafa',
  },
  searchOptionMainPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchOptionIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f3f3',
  },
  searchOptionIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f3f3',
  },
  searchOptionTextCol: {
    flex: 1,
    gap: 2,
  },
  searchOptionTitle: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  searchOptionSubtitle: {
    color: '#666666',
    fontSize: 12,
  },
  pinMapChip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#000000',
  },
  pinMapChipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  searchErrorText: {
    color: '#ee4d4d',
    fontSize: 12,
    fontWeight: '600',
  },
  searchResultsScroll: {
    maxHeight: 200,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececec',
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  searchResultPin: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  searchResultTextCol: {
    flex: 1,
    gap: 2,
  },
  searchResultTitle: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  searchResultSubtitle: {
    color: '#666666',
    fontSize: 12,
  },
  searchEmptyText: {
    color: '#666666',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  pinHintPill: {
    alignSelf: 'center',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  pinHintText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  sheetTitle: {
    color: '#000000',
    fontSize: 19,
    fontWeight: '700',
  },
  sheetCloseButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sheetCloseText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  options: {
    gap: 8,
    paddingBottom: 4,
  },
  optionListScroll: {
    flex: 1,
    minHeight: 0,
  },
  optionButton: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: '#ececec',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  optionButtonSelected: {
    borderColor: '#000000',
    backgroundColor: '#fafafa',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  optionLeft: {
    flex: 1,
    gap: 4,
  },
  optionTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  optionTitle: {
    flexShrink: 1,
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tierBadgeDefault: {
    backgroundColor: '#ececec',
  },
  tierBadgeSelected: {
    backgroundColor: '#000000',
  },
  tierBadgeText: {
    fontFamily: displayFontFamily,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tierBadgeTextDefault: {
    color: '#555555',
  },
  tierBadgeTextSelected: {
    color: '#ffffff',
  },
  optionDescription: {
    color: '#777777',
    fontFamily: displayFontFamily,
    fontSize: 13,
  },
  optionRight: {
    alignItems: 'flex-end',
    gap: 6,
    marginLeft: 12,
  },
  optionTime: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '700',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cccccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#000000',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#000000',
  },
  serviceCheckbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#cccccc',
    borderRadius: 6,
    marginRight: 13,
  },
  serviceCheckboxSelected: {
    borderColor: '#000000',
    backgroundColor: '#000000',
  },
  serviceCheckmark: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
  optionText: {
    flex: 1,
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: '#000000',
    fontWeight: '700',
  },
  optionPrice: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '800',
  },
  confirmButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginTop: 16,
    backgroundColor: '#000000',
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  matchingError: {
    color: '#ee4d4d',
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
    color: '#444444',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 18,
    textAlign: 'center',
  },
  matchingCountdown: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  matchSuccessText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  matchedDapperName: {
    color: '#000000',
    fontSize: 23,
    fontWeight: '700',
    marginTop: 20,
  },
  crispinessStars: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  crispinessRating: {
    color: '#666666',
    fontSize: 14,
    marginTop: 5,
  },
  ratingPrompt: {
    color: '#666666',
    fontSize: 14,
    marginTop: 14,
    textAlign: 'center',
  },
  ratingOptions: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  ratingOption: {
    minWidth: 48,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ececec',
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  ratingOptionSelected: {
    borderColor: '#000000',
    backgroundColor: '#000000',
  },
  ratingOptionText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  ratingOptionTextSelected: {
    color: '#ffffff',
  },
  ratingError: {
    color: '#ee4d4d',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  ratingThanks: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 14,
    textAlign: 'center',
  },
  requestAnotherButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  requestAnotherButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
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
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
  },
  dapperSheetTitle: {
    color: '#000000',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 18,
  },
  dapperSheetService: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  dapperSheetText: {
    color: '#444444',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  dapperSheetHint: {
    color: '#666666',
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
    borderWidth: 1.5,
    borderColor: '#ececec',
    borderRadius: 13,
    backgroundColor: '#ffffff',
  },
  declineButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  acceptButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#000000',
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
    backgroundColor: '#000000',
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
    backgroundColor: '#000000',
    shadowColor: '#000000',
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
  matchedDapperHandle: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  matchedScrollContent: {
    paddingBottom: 28,
  },
  deliveredScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingBottom: 20,
  },
  ratingDescriptor: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  ratingCommentInput: {
    width: '100%',
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: 12,
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    backgroundColor: '#ececec',
  },
  fullWidthButton: {
    width: '100%',
  },
  profileSheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1107,
    elevation: 19,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
  },
  profileScrollContent: {
    paddingBottom: 28,
    gap: 20,
  },
  profileFormSection: {
    gap: 4,
  },
  profileFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  securityBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#ececec',
    flexShrink: 0,
  },
  securityBadgeText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '700',
  },
  changePasswordSection: {
    marginTop: 14,
  },
  changePasswordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#ececec',
  },
  changePasswordCardPressed: {
    backgroundColor: '#f0f0f0',
  },
  changePasswordCardContent: {
    flex: 1,
    marginRight: 12,
  },
  changePasswordCardTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  changePasswordCardSubtitle: {
    color: '#666666',
    fontSize: 12,
  },
  changePasswordArrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ececec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePasswordArrow: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteDangerSection: {
    marginTop: 12,
  },
  deleteAccountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#f5c2c2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  deleteAccountCardPressed: {
    backgroundColor: '#feecec',
  },
  deleteAccountCardTitle: {
    color: '#b42318',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  deleteAccountCardSubtitle: {
    color: '#912018',
    fontSize: 12,
    marginTop: 2,
  },
  deleteAccountArrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fde4e4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteAccountArrow: {
    color: '#b42318',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteWarningBox: {
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#f5c2c2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  deleteWarningTitle: {
    color: '#b42318',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  deleteWarningBody: {
    color: '#7a271a',
    fontSize: 13,
    lineHeight: 18,
  },
  deleteKeyword: {
    color: '#b42318',
    fontWeight: '800',
  },
  deleteConfirmButton: {
    marginTop: 16,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#b42318',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordModalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 1115,
    justifyContent: 'flex-end',
  },
  passwordSheet: {
    width: '100%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
    elevation: 22,
  },
  passwordScrollContent: {
    paddingBottom: 32,
    gap: 4,
  },
  passwordSubtitle: {
    color: '#666666',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  inputLabel: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 6,
    paddingLeft: 2,
  },
  profileInput: {
    height: 50,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 15,
    backgroundColor: '#ececec',
  },
  steamSecurityNote: {
    color: '#666666',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  profileErrorText: {
    color: '#ee4d4d',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
  },
  profileSuccessText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  ratingsSection: {
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fafafa',
    gap: 12,
  },
  ratingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  ratingsTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  modeTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#000000',
  },
  modeTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  refreshLink: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  ratingOverviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ececec',
  },
  ratingScoreColumn: {
    alignItems: 'center',
    minWidth: 92,
  },
  ratingBigNumber: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  ratingStarsText: {
    color: '#000000',
    fontSize: 13,
    letterSpacing: 1,
    marginTop: 2,
  },
  ratingCountLabel: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  ratingBreakdownColumn: {
    flex: 1,
    gap: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownStarLabel: {
    width: 24,
    color: '#555555',
    fontSize: 11,
    fontWeight: '700',
  },
  breakdownTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ececec',
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#000000',
  },
  breakdownCount: {
    width: 22,
    textAlign: 'right',
    color: '#666666',
    fontSize: 11,
    fontWeight: '600',
  },
  ratingsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  ratingsEmptyText: {
    color: '#666666',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  recentRatingsList: {
    gap: 8,
  },
  recentRatingsHeading: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  recentRatingCard: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ececec',
    gap: 4,
  },
  recentRatingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  recentRatingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  recentRaterName: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  serviceChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: '#ececec',
  },
  serviceChipText: {
    color: '#555555',
    fontSize: 10,
    fontWeight: '700',
  },
  recentRatingScore: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  recentRatingComment: {
    color: '#555555',
    fontSize: 13,
    lineHeight: 18,
  },
  recentRatingDate: {
    color: '#666666',
    fontSize: 11,
  },
});
