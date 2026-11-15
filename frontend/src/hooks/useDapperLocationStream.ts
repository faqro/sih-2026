import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { dapperLocationWebSocketUrl } from '../api/auth';
import type { Coordinates } from '../location/dapperLocation';

export type DapperOffer = {
  requestId: string;
  service: string;
  userName: string;
  location: { latitude: number; longitude: number };
  distanceKm: number;
};

export type ActiveDap = {
  requestId: string;
  service: string;
  userName: string;
  location: { latitude: number; longitude: number };
};

type DapperLocationStreamState = {
  acceptOffer: () => void;
  activeDap: ActiveDap | null;
  connectionError: string | null;
  declineOffer: () => void;
  goOffline: () => void;
  goOnline: (initialLocation: Coordinates) => Promise<void>;
  isResponding: boolean;
  isConnecting: boolean;
  isOnline: boolean;
  location: { latitude: number; longitude: number } | null;
  offer: DapperOffer | null;
  markDapDelivered: () => void;
};

export function useDapperLocationStream(
  token: string,
  enabled: boolean,
  onRatingReceived?: (payload: {
    crispinessRating: number;
    crispinessRatingCount: number;
  }) => void,
): DapperLocationStreamState {
  const [isOnline, setIsOnline] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [offer, setOffer] = useState<DapperOffer | null>(null);
  const [activeDap, setActiveDap] = useState<ActiveDap | null>(null);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const locationHeartbeatRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const latestLocationRef = useRef<Coordinates | null>(null);
  const isOnlineRef = useRef(false);
  const shouldStayOnlineRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(false);
  const isEnabledRef = useRef(enabled);
  const onRatingReceivedRef = useRef(onRatingReceived);
  const serverMessageHandlerRef = useRef<
    (message: Record<string, unknown>) => void
  >(() => {});
  const connectAndStreamRef = useRef<
    (initialLocation: Coordinates, isReconnect: boolean) => Promise<void>
  >(async () => {});
  isEnabledRef.current = enabled;
  onRatingReceivedRef.current = onRatingReceived;

  const stopReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const stopLocationHeartbeat = useCallback(() => {
    if (locationHeartbeatRef.current) {
      clearInterval(locationHeartbeatRef.current);
      locationHeartbeatRef.current = null;
    }
  }, []);

  const stopStreaming = useCallback(() => {
    shouldStayOnlineRef.current = false;
    isOnlineRef.current = false;
    reconnectAttemptsRef.current = 0;
    latestLocationRef.current = null;
    stopReconnectTimer();
    stopLocationHeartbeat();
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
  }, [stopLocationHeartbeat, stopReconnectTimer]);

  const handleConnectionClosed = useCallback(
    (socket: WebSocket, code?: number) => {
      if (socketRef.current !== socket) {
        return;
      }

      socketRef.current = null;
      stopLocationHeartbeat();
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;

      const canReconnect =
        shouldStayOnlineRef.current &&
        isMountedRef.current &&
        isEnabledRef.current &&
        code !== 1000 &&
        code !== 1008 &&
        code !== 4001 &&
        latestLocationRef.current !== null &&
        reconnectAttemptsRef.current < 5;

      if (canReconnect) {
        const delayMs = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
        reconnectAttemptsRef.current += 1;
        stopReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          const lastLocation = latestLocationRef.current;
          if (
            shouldStayOnlineRef.current &&
            isMountedRef.current &&
            isEnabledRef.current &&
            lastLocation
          ) {
            void connectAndStreamRef.current(lastLocation, true);
          }
        }, delayMs);
        return;
      }

      shouldStayOnlineRef.current = false;
      isOnlineRef.current = false;
      reconnectAttemptsRef.current = 0;
      latestLocationRef.current = null;

      if (isMountedRef.current) {
        setIsOnline(false);
        setIsConnecting(false);
        setIsResponding(false);
        setOffer(null);
        if (isEnabledRef.current) {
          setConnectionError(
            code === 4001
              ? 'Signed in from another session. Tap Go Online to reconnect.'
              : 'Connection lost. Tap Go Online to reconnect.',
          );
        }
      }
    },
    [stopLocationHeartbeat, stopReconnectTimer],
  );

  const sendLocation = useCallback(
    (socket: WebSocket, location: Coordinates) => {
      if (
        !isOnlineRef.current ||
        !isEnabledRef.current ||
        socketRef.current !== socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      latestLocationRef.current = location;
      if (isMountedRef.current) {
        setLocation(location);
      }

      try {
        socket.send(JSON.stringify({ type: 'location', ...location }));
      } catch {
        handleConnectionClosed(socket);
      }
    },
    [handleConnectionClosed],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopStreaming();
    };
  }, [stopStreaming]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== 'visible' ||
        !shouldStayOnlineRef.current ||
        !isEnabledRef.current
      ) {
        return;
      }

      const socket = socketRef.current;
      const latestLocation = latestLocationRef.current;
      if (socket && socket.readyState === WebSocket.OPEN && latestLocation) {
        sendLocation(socket, latestLocation);
      } else if (
        (!socket || socket.readyState >= WebSocket.CLOSING) &&
        latestLocation &&
        !reconnectTimerRef.current
      ) {
        void connectAndStreamRef.current(latestLocation, true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sendLocation]);

  useEffect(() => {
    if (!enabled) {
      setConnectionError(null);
      setOffer(null);
      setIsResponding(false);
      stopStreaming();
    }
  }, [enabled, stopStreaming]);

  const connectAndStream = useCallback(
    async (initialLocation: Coordinates, isReconnect: boolean) => {
      if (!isEnabledRef.current) {
        return;
      }
      if (!isReconnect && isOnlineRef.current) {
        return;
      }

      if (!isReconnect) {
        shouldStayOnlineRef.current = true;
        reconnectAttemptsRef.current = 0;
        latestLocationRef.current = initialLocation;
        setConnectionError(null);
        setIsConnecting(true);
      }

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (
          !isMountedRef.current ||
          !isEnabledRef.current ||
          !shouldStayOnlineRef.current
        ) {
          return;
        }

        if (permission.status !== 'granted') {
          throw new Error('Location permission is required to go online.');
        }

        const socket = new WebSocket(dapperLocationWebSocketUrl);
        socketRef.current = socket;

        await authenticateSocket(socket, token, (message) =>
          serverMessageHandlerRef.current(message),
        );

        if (
          !isMountedRef.current ||
          !isEnabledRef.current ||
          !shouldStayOnlineRef.current ||
          socketRef.current !== socket
        ) {
          socket.close(1000, 'Dapper went offline.');
          return;
        }

        socket.onerror = () => handleConnectionClosed(socket);
        socket.onclose = (event) => handleConnectionClosed(socket, event.code);

        if (socket.readyState !== WebSocket.OPEN) {
          throw new Error('The location connection closed unexpectedly.');
        }

        reconnectAttemptsRef.current = 0;
        isOnlineRef.current = true;
        sendLocation(socket, latestLocationRef.current ?? initialLocation);

        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 3000,
          },
          (position) => {
            sendLocation(socket, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
        );

        if (
          !isMountedRef.current ||
          !isEnabledRef.current ||
          !shouldStayOnlineRef.current ||
          socketRef.current !== socket ||
          !isOnlineRef.current
        ) {
          subscription.remove();
          return;
        }

        locationSubscriptionRef.current = subscription;
        setIsOnline(true);
        setConnectionError(null);
        stopLocationHeartbeat();
        locationHeartbeatRef.current = setInterval(() => {
          const latestLocation = latestLocationRef.current;
          if (latestLocation) {
            sendLocation(socket, latestLocation);
          }
        }, 10000);
      } catch (error) {
        if (isReconnect && shouldStayOnlineRef.current && reconnectAttemptsRef.current < 5) {
          const delayMs = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
          reconnectAttemptsRef.current += 1;
          stopReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            const lastLocation = latestLocationRef.current;
            if (
              shouldStayOnlineRef.current &&
              isMountedRef.current &&
              isEnabledRef.current &&
              lastLocation
            ) {
              void connectAndStreamRef.current(lastLocation, true);
            }
          }, delayMs);
          return;
        }

        stopStreaming();
        if (isMountedRef.current && isEnabledRef.current) {
          setConnectionError(
            error instanceof Error
              ? error.message
              : 'Unable to start location sharing.',
          );
        }
      } finally {
        if (!isReconnect && isMountedRef.current) {
          setIsConnecting(false);
        }
      }
    },
    [
      handleConnectionClosed,
      sendLocation,
      stopLocationHeartbeat,
      stopReconnectTimer,
      stopStreaming,
      token,
    ],
  );
  connectAndStreamRef.current = connectAndStream;

  const goOnline = useCallback(
    async (initialLocation: Coordinates) => {
      await connectAndStream(initialLocation, false);
    },
    [connectAndStream],
  );

  const goOffline = useCallback(() => {
    setConnectionError(null);
    setOffer(null);
    setIsResponding(false);
    stopStreaming();
  }, [stopStreaming]);

  const handleServerMessage = useCallback(
    (message: Record<string, unknown>) => {
      if (message.type === 'offer') {
        const location = readCoordinates(message.location);
        if (
          typeof message.requestId === 'string' &&
          typeof message.service === 'string' &&
          typeof message.userName === 'string' &&
          location &&
          typeof message.distanceKm === 'number'
        ) {
          setOffer({
            requestId: message.requestId,
            service: message.service,
            userName: message.userName,
            location,
            distanceKm: message.distanceKm,
          });
          setIsResponding(false);
        }
        return;
      }

      if (message.type === 'offer_cancelled' || message.type === 'offer_expired') {
        setOffer((current) =>
          current?.requestId === message.requestId ? null : current,
        );
        setIsResponding(false);
        return;
      }

      if (message.type === 'active_request') {
        const location = readCoordinates(message.location);
        if (
          typeof message.requestId === 'string' &&
          typeof message.service === 'string' &&
          typeof message.userName === 'string' &&
          location
        ) {
          setActiveDap({
            requestId: message.requestId,
            service: message.service,
            userName: message.userName,
            location,
          });
          setOffer(null);
          setIsResponding(false);
        }
        return;
      }

      if (message.type === 'request_cancelled') {
        setActiveDap((current) =>
          current?.requestId === message.requestId ? null : current,
        );
        setIsResponding(false);
        return;
      }

      if (message.type === 'dap_delivered') {
        setActiveDap((current) =>
          current?.requestId === message.requestId ? null : current,
        );
        setIsResponding(false);
        return;
      }

      if (
        message.type === 'rating_received' &&
        typeof message.crispinessRating === 'number' &&
        typeof message.crispinessRatingCount === 'number'
      ) {
        onRatingReceivedRef.current?.({
          crispinessRating: message.crispinessRating,
          crispinessRatingCount: message.crispinessRatingCount,
        });
      }
    },
    [],
  );
  serverMessageHandlerRef.current = handleServerMessage;

  const respondToOffer = useCallback(
    (type: 'accept' | 'decline') => {
      const currentOffer = offer;
      const socket = socketRef.current;
      if (
        !currentOffer ||
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        isResponding
      ) {
        return;
      }

      setIsResponding(true);
      try {
        socket.send(
          JSON.stringify({ type, requestId: currentOffer.requestId }),
        );
      } catch {
        handleConnectionClosed(socket);
        return;
      }
      if (type === 'decline') {
        setOffer(null);
        setIsResponding(false);
      }
    },
    [handleConnectionClosed, isResponding, offer],
  );

  const markDapDelivered = useCallback(() => {
    const socket = socketRef.current;
    if (
      !activeDap ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      isResponding
    ) {
      return;
    }

    setIsResponding(true);
    try {
      socket.send(
        JSON.stringify({ type: 'delivered', requestId: activeDap.requestId }),
      );
    } catch {
      handleConnectionClosed(socket);
    }
  }, [activeDap, handleConnectionClosed, isResponding]);

  return {
    acceptOffer: () => respondToOffer('accept'),
    activeDap,
    connectionError,
    declineOffer: () => respondToOffer('decline'),
    goOffline,
    goOnline,
    isResponding,
    isConnecting,
    isOnline,
    location,
    offer,
    markDapDelivered,
  };
}

function authenticateSocket(
  socket: WebSocket,
  token: string,
  onMessage: (message: Record<string, unknown>) => void,
): Promise<void> {
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
      const message = parseServerMessage(event.data);
      if (!message) {
        finish(new Error('The location service sent an invalid response.'));
        return;
      }

      if (message.type === 'authenticated') {
        finish();
      } else if (isSettled) {
        onMessage(message);
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

function parseServerMessage(data: unknown): Record<string, unknown> | null {
  try {
    const message = JSON.parse(String(data));
    return typeof message === 'object' && message !== null
      ? message as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readCoordinates(value: unknown): { latitude: number; longitude: number } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if (
    !('latitude' in value) ||
    !('longitude' in value) ||
    typeof value.latitude !== 'number' ||
    typeof value.longitude !== 'number'
  ) {
    return null;
  }

  return { latitude: value.latitude, longitude: value.longitude };
}
