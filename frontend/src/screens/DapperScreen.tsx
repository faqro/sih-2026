import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { dapperLocationWebSocketUrl } from '../api/auth';

type DapperScreenProps = {
  accountError: string | null;
  isSubmitting: boolean;
  onDeleteAccount: () => void;
  onSignOut: () => void;
  token: string;
  username: string;
};

export default function DapperScreen({
  accountError,
  isSubmitting,
  onDeleteAccount,
  onSignOut,
  token,
  username,
}: DapperScreenProps) {
  const [isOnline, setIsOnline] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const isOnlineRef = useRef(false);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      isOnlineRef.current = false;
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;

      const socket = socketRef.current;
      socketRef.current = null;

      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, 'Dapper screen closed.');
      }
    };
  }, []);

  function stopStreaming() {
    isOnlineRef.current = false;
    if (isMountedRef.current) {
      setIsOnline(false);
    }
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'Dapper went offline.');
    }
  }

  function handleConnectionClosed(socket: WebSocket) {
    if (socketRef.current !== socket) {
      return;
    }

    socketRef.current = null;
    isOnlineRef.current = false;
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;

    if (isMountedRef.current) {
      setIsOnline(false);
      setIsConnecting(false);
      setConnectionError('Connection lost. Tap Go Online to reconnect.');
    }
  }

  async function goOnline() {
    setConnectionError(null);
    setIsConnecting(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!isMountedRef.current) {
        return;
      }

      if (permission.status !== 'granted') {
        throw new Error('Location permission is required to go online.');
      }

      const socket = new WebSocket(dapperLocationWebSocketUrl);
      socketRef.current = socket;

      await authenticateSocket(socket, token);

      if (!isMountedRef.current || socketRef.current !== socket) {
        return;
      }

      socket.onmessage = null;
      socket.onerror = () => handleConnectionClosed(socket);
      socket.onclose = () => handleConnectionClosed(socket);

      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('The location connection closed unexpectedly.');
      }

      isOnlineRef.current = true;
      setIsOnline(true);

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 5,
          timeInterval: 3000,
        },
        (position) => {
          if (
            !isOnlineRef.current ||
            socketRef.current !== socket ||
            socket.readyState !== WebSocket.OPEN
          ) {
            return;
          }

          try {
            socket.send(
              JSON.stringify({
                type: 'location',
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }),
            );
          } catch {
            handleConnectionClosed(socket);
          }
        },
      );

      if (
        !isMountedRef.current ||
        socketRef.current !== socket ||
        !isOnlineRef.current
      ) {
        subscription.remove();
        return;
      }

      locationSubscriptionRef.current = subscription;
    } catch (error) {
      stopStreaming();
      if (isMountedRef.current) {
        setConnectionError(
          error instanceof Error
            ? error.message
            : 'Unable to start location sharing.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsConnecting(false);
      }
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{username.charAt(0)}</Text>
      </View>
      <Text style={styles.eyebrow}>DAPPER ACCOUNT</Text>
      <Text style={styles.title}>Dapper dashboard</Text>
      <Text style={styles.description}>Welcome, {username}.</Text>
      <Text style={[styles.status, isOnline && styles.onlineStatus]}>
        {isOnline
          ? 'You are online. Your location is being shared.'
          : 'You are offline. Your location is not being shared.'}
      </Text>
      {connectionError ? (
        <Text style={styles.error}>{connectionError}</Text>
      ) : null}
      {accountError ? <Text style={styles.error}>{accountError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={isConnecting || isSubmitting}
        onPress={isOnline ? stopStreaming : goOnline}
        style={[
          styles.onlineButton,
          isOnline && styles.offlineButton,
          (isConnecting || isSubmitting) && styles.disabledButton,
        ]}
      >
        {isConnecting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.onlineButtonText}>
            {isOnline ? 'Go Offline' : 'Go Online'}
          </Text>
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={onSignOut}
        style={[styles.secondaryButton, isSubmitting && styles.disabledButton]}
      >
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={onDeleteAccount}
        style={[
          styles.deleteButton,
          isSubmitting && styles.disabledButton,
        ]}
      >
        <Text style={styles.deleteButtonText}>
          {isSubmitting ? 'Deleting account...' : 'Delete account'}
        </Text>
      </Pressable>
    </View>
  );
}

function authenticateSocket(socket: WebSocket, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let isSettled = false;
    let timeout: ReturnType<typeof setTimeout>;

    function finish(error?: Error) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeout);

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    timeout = setTimeout(() => {
      finish(new Error('Timed out connecting to the location service.'));
    }, 10000);

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ type: 'authenticate', token }));
      } catch {
        finish(new Error('Unable to authenticate the location connection.'));
      }
    };

    socket.onmessage = (event) => {
      let message: unknown;

      try {
        message = JSON.parse(String(event.data));
      } catch {
        finish(new Error('The location service sent an invalid response.'));
        return;
      }

      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'authenticated'
      ) {
        finish();
      } else {
        finish(new Error('Unable to authenticate the location connection.'));
      }
    };

    socket.onerror = () => {
      finish(new Error('Unable to connect to the location service.'));
    };

    socket.onclose = () => {
      finish(new Error('The location service closed the connection.'));
    };
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  avatar: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 38,
    marginBottom: 23,
    backgroundColor: '#dfe7ff',
  },
  avatarText: {
    color: '#314b9a',
    fontSize: 32,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  eyebrow: {
    color: '#526cc2',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    color: '#6f7a90',
    fontSize: 15,
    marginBottom: 18,
  },
  status: {
    color: '#6f7a90',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    textAlign: 'center',
  },
  onlineStatus: {
    color: '#147a52',
  },
  error: {
    color: '#b42318',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
    textAlign: 'center',
  },
  onlineButton: {
    width: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    marginBottom: 12,
    backgroundColor: '#16845b',
  },
  offlineButton: {
    backgroundColor: '#b42318',
  },
  onlineButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  secondaryButton: {
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd3e3',
    borderRadius: 13,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: '#405bb6',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteButton: {
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f0b8b5',
    borderRadius: 13,
    marginTop: 12,
    paddingVertical: 13,
  },
  deleteButtonText: {
    color: '#b42318',
    fontSize: 14,
    fontWeight: '700',
  },
});
