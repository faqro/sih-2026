import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { dapperLocationWebSocketUrl } from '../api/auth';
import type { Coordinates } from '../location/dapperLocation';

export type MatchedDapper = {
  id: string;
  username: string;
  name?: string | null;
  crispinessRating: number;
  crispinessRatingCount?: number;
};

export type DapRequestStatus =
  | 'idle'
  | 'connecting'
  | 'searching'
  | 'matched'
  | 'failed'
  | 'delivered';

type DapRequestState = {
  status: DapRequestStatus;
  requestId: string | null;
  deadlineAt: number | null;
  secondsRemaining: number;
  matchedDapper: MatchedDapper | null;
  matchedDapperLocation: Coordinates | null;
  userLocation: Coordinates | null;
  error: string | null;
};

type StartRequestOptions = {
  useLiveLocation?: boolean;
};

type DapRequestController = DapRequestState & {
  cancelRequest: () => void;
  isRestoring: boolean;
  resetRequest: () => void;
  startRequest: (
    service: string,
    location: { latitude: number; longitude: number },
    options?: StartRequestOptions,
  ) => Promise<void>;
};

const initialState: DapRequestState = {
  status: 'idle',
  requestId: null,
  deadlineAt: null,
  secondsRemaining: 600,
  matchedDapper: null,
  matchedDapperLocation: null,
  userLocation: null,
  error: null,
};

export function useDapRequest(
  token: string,
  enabled: boolean,
): DapRequestController {
  const [state, setState] = useState(initialState);
  const [isRestoring, setIsRestoring] = useState(false);
  const stateRef = useRef(initialState);
  const socketRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const locationStartSocketRef = useRef<WebSocket | null>(null);
  const isMountedRef = useRef(false);
  const isEnabledRef = useRef(enabled);
  const hasRestoredRef = useRef(false);
  const useLiveLocationRef = useRef(true);
  const reconnectRequestRef = useRef<() => void>(() => {});
  isEnabledRef.current = enabled;

  const stopPingHeartbeat = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const stopReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const startPingHeartbeat = useCallback(
    (socket: WebSocket) => {
      stopPingHeartbeat();
      pingIntervalRef.current = setInterval(() => {
        if (
          socketRef.current !== socket ||
          socket.readyState !== WebSocket.OPEN
        ) {
          stopPingHeartbeat();
          return;
        }
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // Ignore send errors; socket.onclose will handle reconnection.
        }
      }, 20000);
    },
    [stopPingHeartbeat],
  );

  const updateState = useCallback((update: (current: DapRequestState) => DapRequestState) => {
    const nextState = update(stateRef.current);
    stateRef.current = nextState;
    if (isMountedRef.current) {
      setState(nextState);
    }
  }, []);

  const closeSocket = useCallback(
    (cancelPending: boolean) => {
      stopPingHeartbeat();
      stopReconnectTimer();
      reconnectAttemptsRef.current = 0;
      const socket = socketRef.current;
      socketRef.current = null;

      if (socket?.readyState === WebSocket.OPEN && cancelPending) {
        try {
          socket.send(JSON.stringify({ type: 'cancel_request' }));
        } catch {
          socket.close();
        }
      }

      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, 'UberDap request ended.');
      }
    },
    [stopPingHeartbeat, stopReconnectTimer],
  );

  const stopLocationUpdates = useCallback(() => {
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;
    locationStartSocketRef.current = null;
  }, []);

  const startLocationUpdates = useCallback(
    async (socket: WebSocket) => {
      if (
        !useLiveLocationRef.current ||
        !isMountedRef.current ||
        !isEnabledRef.current ||
        socketRef.current !== socket ||
        stateRef.current.status !== 'searching' ||
        locationSubscriptionRef.current ||
        locationStartSocketRef.current === socket
      ) {
        return;
      }

      locationStartSocketRef.current = socket;

      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          return;
        }

        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 3000,
          },
          (position) => {
            if (
              stateRef.current.status !== 'searching' ||
              !isEnabledRef.current ||
              socketRef.current !== socket ||
              socket.readyState !== WebSocket.OPEN
            ) {
              return;
            }

            const userLocation = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
            updateState((current) =>
              current.status === 'searching'
                ? { ...current, userLocation }
                : current,
            );

            try {
              socket.send(
                JSON.stringify({
                  type: 'location',
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                }),
              );
            } catch {
              stopLocationUpdates();
              closeSocket(true);
              updateState((current) => ({
                ...current,
                status: 'failed',
                deadlineAt: null,
                error: 'Connection lost while sharing your location.',
              }));
            }
          },
        );

        if (
          !isMountedRef.current ||
          !isEnabledRef.current ||
          socketRef.current !== socket ||
          stateRef.current.status !== 'searching'
        ) {
          subscription.remove();
          return;
        }

        locationSubscriptionRef.current = subscription;
      } catch (error) {
        if (
          isMountedRef.current &&
          isEnabledRef.current &&
          socketRef.current === socket &&
          stateRef.current.status === 'searching'
        ) {
          closeSocket(true);
          updateState((current) => ({
            ...current,
            status: 'failed',
            deadlineAt: null,
            error:
              error instanceof Error
                ? error.message
                : 'Unable to stream your location.',
          }));
        }
      } finally {
        if (locationStartSocketRef.current === socket) {
          locationStartSocketRef.current = null;
        }
      }
    },
    [closeSocket, stopLocationUpdates, updateState],
  );

  const cancelRequest = useCallback(() => {
    const status = stateRef.current.status;
    if (status !== 'connecting' && status !== 'searching') {
      return;
    }

    useLiveLocationRef.current = true;
    stopLocationUpdates();
    closeSocket(true);
    updateState(() => initialState);
  }, [closeSocket, stopLocationUpdates, updateState]);

  const resetRequest = useCallback(() => {
    if (stateRef.current.status === 'delivered' || stateRef.current.status === 'failed') {
      useLiveLocationRef.current = true;
      stopLocationUpdates();
      closeSocket(false);
      updateState(() => initialState);
    }
  }, [closeSocket, stopLocationUpdates, updateState]);

  const handleServerMessage = useCallback(
    (socket: WebSocket, message: Record<string, unknown>) => {
      if (socketRef.current !== socket) {
        return;
      }

      if (message.type === 'request_state') {
        if (message.status === 'idle') {
          closeSocket(false);
          updateState(() => initialState);
          return;
        }

        if (message.status === 'searching') {
          message = { ...message, type: 'request_started' };
        } else if (message.status === 'matched') {
          message = { ...message, type: 'request_matched' };
        }
      }

      if (
        message.type === 'request_started' &&
        typeof message.requestId === 'string' &&
        typeof message.deadlineAt === 'number'
      ) {
        updateState((current) => ({
          ...current,
          status: 'searching',
          requestId: message.requestId as string,
          deadlineAt: message.deadlineAt as number,
          secondsRemaining: Math.max(
            0,
            Math.ceil((message.deadlineAt as number - Date.now()) / 1000),
          ),
          matchedDapper: null,
          matchedDapperLocation: null,
          error: null,
        }));
        void startLocationUpdates(socket);
        return;
      }

      if (
        message.type === 'dapper_location' &&
        typeof message.requestId === 'string' &&
        message.requestId === stateRef.current.requestId
      ) {
        const location = readCoordinates(message.location);
        if (location) {
          updateState((current) => ({
            ...current,
            matchedDapperLocation: location,
          }));
        }
        return;
      }

      if (
        message.type === 'request_matched' &&
        typeof message.dapper === 'object' &&
        message.dapper !== null &&
        'id' in message.dapper &&
        typeof message.dapper.id === 'string' &&
        'username' in message.dapper &&
        typeof message.dapper.username === 'string' &&
        'crispinessRating' in message.dapper &&
        typeof message.dapper.crispinessRating === 'number'
      ) {
        const dapperLocation =
          'location' in message.dapper
            ? readCoordinates(message.dapper.location)
            : null;
        const dapperName =
          'name' in message.dapper && typeof message.dapper.name === 'string'
            ? message.dapper.name
            : null;
        const crispinessRatingCount =
          'crispinessRatingCount' in message.dapper &&
          typeof message.dapper.crispinessRatingCount === 'number'
            ? message.dapper.crispinessRatingCount
            : undefined;
        stateRef.current = {
          ...stateRef.current,
          status: 'matched',
          matchedDapper: {
            id: message.dapper.id,
            username: message.dapper.username,
            name: dapperName,
            crispinessRating: message.dapper.crispinessRating,
            crispinessRatingCount,
          },
          matchedDapperLocation: dapperLocation,
        };
        stopLocationUpdates();
        if (isMountedRef.current) {
          setState(stateRef.current);
        }
        return;
      }

      if (message.type === 'request_failed') {
        stopLocationUpdates();
        closeSocket(false);
        updateState((current) => ({
          ...current,
          status: 'failed',
          deadlineAt: null,
          secondsRemaining: 0,
          error:
            message.reason === 'timeout'
              ? null
              : 'Your UberDap request could not be completed.',
        }));
        return;
      }

      if (message.type === 'request_cancelled') {
        stopLocationUpdates();
        closeSocket(false);
        updateState(() => initialState);
        return;
      }

      if (message.type === 'request_error') {
        stopLocationUpdates();
        closeSocket(false);
        updateState((current) => ({
          ...current,
          status: 'failed',
          deadlineAt: null,
          error:
            typeof message.message === 'string'
              ? message.message
              : 'Unable to start your UberDap request.',
        }));
        return;
      }

      if (message.type === 'dap_delivered') {
        stopLocationUpdates();
        closeSocket(false);
        updateState((current) => ({
          ...current,
          status: 'delivered',
          deadlineAt: null,
        }));
      }
    },
    [closeSocket, startLocationUpdates, stopLocationUpdates, updateState],
  );

  const startRequest = useCallback(
    async (
      service: string,
      location: { latitude: number; longitude: number },
      options?: StartRequestOptions,
    ) => {
      if (!isEnabledRef.current || socketRef.current) {
        return;
      }

      useLiveLocationRef.current = options?.useLiveLocation ?? true;
      updateState(() => ({
        ...initialState,
        status: 'connecting',
        userLocation: location,
      }));

      try {
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

        socket.onmessage = (event) => {
          const message = parseServerMessage(event.data);
          if (message) {
            handleServerMessage(socket, message);
          }
        };
        socket.onclose = (event) => {
          if (socketRef.current !== socket) {
            return;
          }
          socketRef.current = null;
          stopPingHeartbeat();
          stopLocationUpdates();
          const currentStatus = stateRef.current.status;
          const canReconnect =
            isMountedRef.current &&
            isEnabledRef.current &&
            event.code !== 1000 &&
            event.code !== 1008 &&
            event.code !== 4001 &&
            (currentStatus === 'searching' || currentStatus === 'matched') &&
            reconnectAttemptsRef.current < 4;

          if (canReconnect) {
            reconnectRequestRef.current();
            return;
          }

          if (currentStatus === 'searching') {
            updateState((current) => ({
              ...current,
              status: 'failed',
              deadlineAt: null,
              error: 'Connection lost while matching. Please try again.',
            }));
          }
        };
        socket.onerror = () => {
          if (socketRef.current === socket) {
            updateState((current) => ({
              ...current,
              error: 'Connection error while matching your UberDap.',
            }));
          }
        };

        if (socket.readyState !== WebSocket.OPEN) {
          throw new Error('The request connection closed unexpectedly.');
        }

        reconnectAttemptsRef.current = 0;
        startPingHeartbeat(socket);

        socket.send(
          JSON.stringify({
            type: 'request',
            service,
            latitude: location.latitude,
            longitude: location.longitude,
          }),
        );
        const deadlineAt = Date.now() + 10 * 60 * 1000;
        updateState((current) => ({
          ...current,
          status: 'searching',
          deadlineAt,
          secondsRemaining: 600,
          error: null,
        }));
        void startLocationUpdates(socket);
      } catch (error) {
        stopLocationUpdates();
        closeSocket(true);
        updateState((current) => ({
          ...current,
          status: 'failed',
          deadlineAt: null,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to start your UberDap request.',
        }));
      }
    },
    [
      closeSocket,
      handleServerMessage,
      startLocationUpdates,
      startPingHeartbeat,
      stopLocationUpdates,
      stopPingHeartbeat,
      token,
      updateState,
    ],
  );

  const resumeActiveRequest = useCallback(async (isReconnect = false) => {
    if (!isEnabledRef.current || (!isReconnect && hasRestoredRef.current)) {
      return;
    }

    hasRestoredRef.current = true;
    if (!isReconnect) {
      setIsRestoring(true);
    }

    try {
      const socket = new WebSocket(dapperLocationWebSocketUrl);
      socketRef.current = socket;

      await authenticateSocket(
        socket,
        token,
        (message) => handleServerMessage(socket, message),
        true,
      );

      if (
        !isMountedRef.current ||
        !isEnabledRef.current ||
        socketRef.current !== socket
      ) {
        return;
      }

      reconnectAttemptsRef.current = 0;
      startPingHeartbeat(socket);

      socket.onmessage = (event) => {
        const message = parseServerMessage(event.data);
        if (message) {
          handleServerMessage(socket, message);
        }
      };
      socket.onclose = (event) => {
        if (socketRef.current !== socket) {
          return;
        }
        socketRef.current = null;
        stopPingHeartbeat();
        stopLocationUpdates();
        const currentStatus = stateRef.current.status;
        const canReconnect =
          isMountedRef.current &&
          isEnabledRef.current &&
          event.code !== 1000 &&
          event.code !== 1008 &&
          event.code !== 4001 &&
          (currentStatus === 'searching' || currentStatus === 'matched') &&
          reconnectAttemptsRef.current < 4;

        if (canReconnect) {
          reconnectRequestRef.current();
          return;
        }

        if (currentStatus === 'searching') {
          updateState((current) => ({
            ...current,
            status: 'failed',
            deadlineAt: null,
            error: 'Connection lost while matching. Please try again.',
          }));
        }
      };
      socket.onerror = () => {
        if (socketRef.current === socket) {
          updateState((current) => ({
            ...current,
            error: 'Connection error while restoring your UberDap.',
          }));
        }
      };

      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('The request connection closed unexpectedly.');
      }
    } catch (error) {
      if (
        isReconnect &&
        isMountedRef.current &&
        isEnabledRef.current &&
        (stateRef.current.status === 'searching' ||
          stateRef.current.status === 'matched') &&
        reconnectAttemptsRef.current < 4
      ) {
        reconnectRequestRef.current();
        return;
      }
      closeSocket(false);
      if (isMountedRef.current) {
        updateState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to restore your active UberDap.',
        }));
      }
    } finally {
      if (!isReconnect && isMountedRef.current) {
        setIsRestoring(false);
      }
    }
  }, [
    closeSocket,
    handleServerMessage,
    startPingHeartbeat,
    stopLocationUpdates,
    stopPingHeartbeat,
    token,
    updateState,
  ]);

  reconnectRequestRef.current = () => {
    const delayMs = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 8000);
    reconnectAttemptsRef.current += 1;
    stopReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (
        isMountedRef.current &&
        isEnabledRef.current &&
        (stateRef.current.status === 'searching' ||
          stateRef.current.status === 'matched')
      ) {
        void resumeActiveRequest(true);
      }
    }, delayMs);
  };

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopLocationUpdates();
      const status = stateRef.current.status;
      closeSocket(status === 'connecting' || status === 'searching');
    };
  }, [closeSocket, stopLocationUpdates]);

  useEffect(() => {
    if (!enabled) {
      hasRestoredRef.current = false;
      cancelRequest();
      if (stateRef.current.status === 'idle') {
        closeSocket(false);
      }
      setIsRestoring(false);
      return;
    }

    void resumeActiveRequest();
  }, [cancelRequest, closeSocket, enabled, resumeActiveRequest]);

  useEffect(() => {
    if (state.status !== 'searching' || state.deadlineAt === null) {
      return;
    }

    const updateCountdown = () => {
      const secondsRemaining = Math.max(
        0,
        Math.ceil((state.deadlineAt! - Date.now()) / 1000),
      );
      updateState((current) =>
        current.status === 'searching'
          ? { ...current, secondsRemaining }
          : current,
      );
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [state.deadlineAt, state.status, updateState]);

  return {
    ...state,
    cancelRequest,
    isRestoring,
    resetRequest,
    startRequest,
  };
}

function readCoordinates(value: unknown): Coordinates | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('latitude' in value) ||
    !('longitude' in value) ||
    typeof value.latitude !== 'number' ||
    typeof value.longitude !== 'number' ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    return null;
  }

  return { latitude: value.latitude, longitude: value.longitude };
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

function authenticateSocket(
  socket: WebSocket,
  token: string,
  onMessage?: (message: Record<string, unknown>) => void,
  restoreRequestState = false,
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

    timeout = setTimeout(
      () => finish(new Error('Timed out connecting to the request service.')),
      10000,
    );

    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify({
            type: 'authenticate',
            token,
            ...(restoreRequestState ? { restoreRequestState: true } : {}),
          }),
        );
      } catch {
        finish(new Error('Unable to authenticate the request connection.'));
      }
    };

    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message?.type === 'authenticated') {
        finish();
      } else if (isSettled && message && onMessage) {
        onMessage(message);
      } else {
        finish(new Error('Unable to authenticate the request connection.'));
      }
    };

    socket.onerror = () =>
      finish(new Error('Unable to connect to the request service.'));
    socket.onclose = () =>
      finish(new Error('The request service closed the connection.'));
  });
}
