import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import UserMapSurface from './UserMapSurface';

type UserMapScreenProps = {
  error: string | null;
  isSubmitting: boolean;
  onDeleteAccount: () => void;
  onSignOut: () => void;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

export default function UserMapScreen({
  error,
  isSubmitting,
  onDeleteAccount,
  onSignOut,
}: UserMapScreenProps) {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

  return (
    <View style={styles.container}>
      {location ? <UserMapSurface location={location} /> : (
        <View style={styles.mapPlaceholder} />
      )}

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
        <View style={styles.topRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isMenuOpen ? 'Close account menu' : 'Open account menu'}
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

        <View style={styles.bottomActions}>
          <Pressable accessibilityRole="button" style={styles.requestButton}>
            <Text style={styles.requestButtonText}>Request UberDap</Text>
          </Pressable>
        </View>
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
  mapPlaceholder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#e8edf5',
  },
  locationMessage: {
    position: 'absolute',
    top: '42%',
    zIndex: 1101,
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
  topRight: {
    position: 'absolute',
    top: 16,
    right: 16,
    alignItems: 'flex-end',
    zIndex: 1102,
    elevation: 12,
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
    width: 200,
    marginTop: 10,
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
});
