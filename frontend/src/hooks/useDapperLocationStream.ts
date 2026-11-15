import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { dapperLocationWebSocketUrl } from '../api/auth';

type DapperLocationStreamState = {
  connectionError: string | null;
  goOffline: () => void;
  goOnline: () => Promise<void>;
  isConnecting: boolean;
  isOnline: boolean;
};

export function useDapperLocationStream(
  token: string,
  enabled: boolean,
): DapperLocationStreamState {
  const [isOnline, setIsOnline] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const isOnlineRef = useRef(false);
  const isMountedRef = useRef(false);
  const isEnabledRef = useRef(enabled);
  isEnabledRef.current = enabled;

  const stopStreaming = useCallback(() => {
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
  }, []);

  const handleConnectionClosed = useCallback(
    (socket: WebSocket) => {
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
        if (isEnabledRef.current) {
          setConnectionError('Connection lost. Tap Go Online to reconnect.');
        }
      }
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopStreaming();
    };
  }, [stopStreaming]);

  useEffect(() => {
    if (!enabled) {
      setConnectionError(null);
      stopStreaming();
    }
  }, [enabled, stopStreaming]);

  const goOnline = useCallback(async () => {
    if (!isEnabledRef.current || isOnlineRef.current) {
      return;
    }

    setConnectionError(null);
    setIsConnecting(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!isMountedRef.current || !isEnabledRef.current) {
        return;
      }

      if (permission.status !== 'granted') {
        throw new Error('Location permission is required to go online.');
      }

      const socket = new WebSocket(dapperLocationWebSocketUrl);
      socketRef.current = socket;

      await authenticateSocket(socket, token);

      if (
        !isMountedRef.current ||
        !isEnabledRef.current ||
        socketRef.current !== socket
      ) {
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
            !isEnabledRef.current ||
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
        !isEnabledRef.current ||
        socketRef.current !== socket ||
        !isOnlineRef.current
      ) {
        subscription.remove();
        return;
      }

      locationSubscriptionRef.current = subscription;
    } catch (error) {
      stopStreaming();
      if (isMountedRef.current && isEnabledRef.current) {
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
  }, [handleConnectionClosed, stopStreaming, token]);

  const goOffline = useCallback(() => {
    setConnectionError(null);
    stopStreaming();
  }, [stopStreaming]);

  return {
    connectionError,
    goOffline,
    goOnline,
    isConnecting,
    isOnline,
  };
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
