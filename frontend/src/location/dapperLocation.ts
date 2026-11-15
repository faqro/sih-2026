export type Coordinates = {
  latitude: number;
  longitude: number;
};

export const DEFAULT_MAP_COORDINATES: Coordinates = {
  latitude: 39.8283,
  longitude: -98.5795,
};

export type DapperLocationFailureReason =
  | 'services-disabled'
  | 'permission-denied'
  | 'location-unavailable';

export type DapperLocationGateResult =
  | {
      ok: true;
      coordinates: Coordinates;
    }
  | {
      ok: false;
      reason: DapperLocationFailureReason;
      canOpenSettings: boolean;
      message: string;
    };

export type LocationPermissionResult = {
  status: string;
  granted?: boolean;
  canAskAgain?: boolean;
};

export type LocationPositionResult = {
  coords: {
    latitude: number;
    longitude: number;
  };
};

export type DapperLocationProvider = {
  hasServicesEnabledAsync: () => Promise<boolean>;
  getForegroundPermissionsAsync: () => Promise<LocationPermissionResult>;
  requestForegroundPermissionsAsync: () => Promise<LocationPermissionResult>;
  getCurrentPositionAsync: () => Promise<LocationPositionResult>;
};

export type ResolveDapperLocationOptions = {
  isNative: boolean;
};

export type WebGeolocationPositionLike = {
  coords: {
    latitude: number;
    longitude: number;
  };
};

export type WebGeolocationLike = {
  getCurrentPosition: (
    successCallback: (position: WebGeolocationPositionLike) => void,
    errorCallback?: (error: unknown) => void,
    options?: {
      enableHighAccuracy?: boolean;
      maximumAge?: number;
      timeout?: number;
    },
  ) => void;
};

export type WebPermissionsLike = {
  query: (descriptor: { name: 'geolocation' }) => Promise<{ state?: string }>;
};

export type WebNavigatorLike = {
  geolocation?: WebGeolocationLike | null;
  permissions?: WebPermissionsLike | null;
};

const WEB_GEOLOCATION_TIMEOUT_MS = 15000;

const SERVICES_DISABLED_MESSAGE =
  'Location services are turned off. Enable location services on your device to go online as a Dapper.';
const BLOCKED_PERMISSION_MESSAGE =
  'Location permission is blocked. Open your device settings, allow location access while using the app, and try again.';
const REQUIRED_PERMISSION_MESSAGE =
  'Location permission is required to go online as a Dapper. Allow location access in your browser or device settings and try again.';
const LOCATION_UNAVAILABLE_MESSAGE =
  'Unable to get your current location. Check that location services are enabled and try again.';

function isPermissionDeniedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  return (
    code === 1 ||
    code === 'E_LOCATION_UNAUTHORIZED' ||
    code === 'ERR_LOCATION_UNAUTHORIZED' ||
    code === 'ERR_DENIED_FOREGROUND_LOCATION_PERMISSION'
  );
}

function isServicesDisabledError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  return (
    code === 'E_LOCATION_SERVICES_DISABLED' ||
    code === 'ERR_LOCATION_SERVICES_DISABLED' ||
    code === 'ERR_LOCATION_SETTINGS_UNSATISFIED'
  );
}

function isPermissionGranted(permission: LocationPermissionResult): boolean {
  return permission.status === 'granted' && permission.granted !== false;
}

function areValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function classifyPositionFailure(
  error: unknown,
  isNative: boolean,
): DapperLocationGateResult {
  if (isServicesDisabledError(error)) {
    return {
      ok: false,
      reason: 'services-disabled',
      canOpenSettings: false,
      message: SERVICES_DISABLED_MESSAGE,
    };
  }

  if (isPermissionDeniedError(error)) {
    return {
      ok: false,
      reason: 'permission-denied',
      canOpenSettings: isNative,
      message: isNative
        ? BLOCKED_PERMISSION_MESSAGE
        : REQUIRED_PERMISSION_MESSAGE,
    };
  }

  return {
    ok: false,
    reason: 'location-unavailable',
    canOpenSettings: false,
    message: LOCATION_UNAVAILABLE_MESSAGE,
  };
}

export async function resolveWebDapperOnlineLocation(
  webNavigator: WebNavigatorLike | undefined = typeof globalThis !==
  'undefined'
    ? (globalThis.navigator as WebNavigatorLike | undefined)
    : undefined,
): Promise<DapperLocationGateResult> {
  const geolocation = webNavigator?.geolocation;

  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return {
      ok: false,
      reason: 'services-disabled',
      canOpenSettings: false,
      message: SERVICES_DISABLED_MESSAGE,
    };
  }

  if (typeof webNavigator.permissions?.query === 'function') {
    try {
      const permission = await webNavigator.permissions.query({
        name: 'geolocation',
      });

      if (permission?.state === 'denied') {
        return {
          ok: false,
          reason: 'permission-denied',
          canOpenSettings: false,
          message: REQUIRED_PERMISSION_MESSAGE,
        };
      }
    } catch {
      // Browsers without geolocation support in navigator.permissions.query
      // still prompt and resolve via navigator.geolocation.getCurrentPosition.
    }
  }

  try {
    const currentPosition = await new Promise<WebGeolocationPositionLike>(
      (resolve, reject) => {
        try {
          geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            maximumAge: 0,
            timeout: WEB_GEOLOCATION_TIMEOUT_MS,
          });
        } catch (syncError) {
          reject(syncError);
        }
      },
    );

    const latitude = currentPosition?.coords?.latitude;
    const longitude = currentPosition?.coords?.longitude;

    if (!areValidCoordinates(latitude, longitude)) {
      return {
        ok: false,
        reason: 'location-unavailable',
        canOpenSettings: false,
        message: LOCATION_UNAVAILABLE_MESSAGE,
      };
    }

    return {
      ok: true,
      coordinates: { latitude, longitude },
    };
  } catch (error) {
    return classifyPositionFailure(error, false);
  }
}

export async function resolveDapperOnlineLocation(
  provider: DapperLocationProvider,
  { isNative }: ResolveDapperLocationOptions,
): Promise<DapperLocationGateResult> {
  let servicesEnabled: boolean;

  try {
    servicesEnabled = await provider.hasServicesEnabledAsync();
  } catch {
    servicesEnabled = false;
  }

  if (!servicesEnabled) {
    return {
      ok: false,
      reason: 'services-disabled',
      canOpenSettings: false,
      message: SERVICES_DISABLED_MESSAGE,
    };
  }

  let permission: LocationPermissionResult;

  try {
    const existingPermission = await provider.getForegroundPermissionsAsync();

    if (isPermissionGranted(existingPermission)) {
      permission = existingPermission;
    } else if (existingPermission.canAskAgain === false) {
      permission = existingPermission;
    } else {
      permission = await provider.requestForegroundPermissionsAsync();
    }
  } catch {
    return {
      ok: false,
      reason: 'permission-denied',
      canOpenSettings: false,
      message: REQUIRED_PERMISSION_MESSAGE,
    };
  }

  if (!isPermissionGranted(permission)) {
    const canAskAgain = permission.canAskAgain !== false;
    const canOpenSettings = isNative && !canAskAgain;

    return {
      ok: false,
      reason: 'permission-denied',
      canOpenSettings,
      message: canOpenSettings
        ? BLOCKED_PERMISSION_MESSAGE
        : REQUIRED_PERMISSION_MESSAGE,
    };
  }

  try {
    const currentPosition = await provider.getCurrentPositionAsync();
    const latitude = currentPosition?.coords?.latitude;
    const longitude = currentPosition?.coords?.longitude;

    if (!areValidCoordinates(latitude, longitude)) {
      return {
        ok: false,
        reason: 'location-unavailable',
        canOpenSettings: false,
        message: LOCATION_UNAVAILABLE_MESSAGE,
      };
    }

    return {
      ok: true,
      coordinates: { latitude, longitude },
    };
  } catch (error) {
    return classifyPositionFailure(error, isNative);
  }
}
