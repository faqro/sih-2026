import { memo, useEffect, useRef } from 'react';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type MapStyleElement,
  type Region,
} from 'react-native-maps';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import type { AppMode } from '../api/auth';
import {
  DEFAULT_MAP_COORDINATES,
  type Coordinates,
} from '../location/dapperLocation';

const DEFAULT_REGION: Region = {
  ...DEFAULT_MAP_COORDINATES,
  latitudeDelta: 28,
  longitudeDelta: 36,
};

function toActiveRegion(location: Coordinates): Region {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  };
}

function toVisibleRegion(location: Coordinates, sheetOpen: boolean): Region {
  const region = toActiveRegion(location);
  return sheetOpen
    ? { ...region, latitude: region.latitude - region.latitudeDelta * 0.45 }
    : region;
}

const minimalMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#f3f5f6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#70777c' }] },
  { featureType: 'administrative', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#dce7ed' }],
  },
];

export type MapSurfaceProps = {
  ownLocation: Coordinates | null;
  counterpartLocation: Coordinates | null;
  isSheetOpen: boolean;
  mode: AppMode;
};

function MapSurface({
  ownLocation,
  counterpartLocation,
  isSheetOpen,
  mode,
}: MapSurfaceProps) {
  const { height: viewportHeight } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const isMapReadyRef = useRef(false);
  const initialHadLocationRef = useRef(
    Boolean(ownLocation || counterpartLocation),
  );
  const hadLocationRef = useRef(Boolean(ownLocation || counterpartLocation));
  const initialRegionRef = useRef<Region>(
    ownLocation
      ? toActiveRegion(ownLocation)
      : counterpartLocation
        ? toActiveRegion(counterpartLocation)
        : DEFAULT_REGION,
  );
  const latestMapStateRef = useRef({
    ownLocation,
    counterpartLocation,
    isSheetOpen,
  });
  latestMapStateRef.current = { ownLocation, counterpartLocation, isSheetOpen };

  useEffect(() => {
    if (ownLocation && counterpartLocation) {
      if (isMapReadyRef.current) {
        focusBothLocations(ownLocation, counterpartLocation, isSheetOpen, true);
      }
      hadLocationRef.current = true;
      return;
    }

    const location = ownLocation ?? counterpartLocation;
    if (location) {
      if (isMapReadyRef.current) {
        mapRef.current?.animateToRegion(
          toVisibleRegion(location, isSheetOpen),
          350,
        );
      }
      hadLocationRef.current = true;
    } else if (hadLocationRef.current) {
      if (isMapReadyRef.current) {
        mapRef.current?.animateToRegion(DEFAULT_REGION, 350);
      }
      hadLocationRef.current = false;
    }
  }, [
    ownLocation?.latitude,
    ownLocation?.longitude,
    counterpartLocation?.latitude,
    counterpartLocation?.longitude,
    isSheetOpen,
    viewportHeight,
  ]);

  function focusBothLocations(
    first: Coordinates,
    second: Coordinates,
    sheetOpen: boolean,
    animated: boolean,
  ) {
    if (
      Math.abs(first.latitude - second.latitude) < 0.001 &&
      Math.abs(first.longitude - second.longitude) < 0.001
    ) {
      mapRef.current?.animateToRegion(
        toVisibleRegion(first, sheetOpen),
        animated ? 350 : 0,
      );
      return;
    }

    mapRef.current?.fitToCoordinates([first, second], {
      edgePadding: {
        top: 90,
        right: 48,
        bottom: sheetOpen ? viewportHeight / 2 + 32 : 150,
        left: 48,
      },
      animated,
    });
  }

  return (
    <MapView
      ref={mapRef}
      customMapStyle={minimalMapStyle}
      initialRegion={initialRegionRef.current}
      onMapReady={() => {
        isMapReadyRef.current = true;
        const {
          ownLocation: latestOwn,
          counterpartLocation: latestCounterpart,
          isSheetOpen: latestSheetOpen,
        } = latestMapStateRef.current;
        if (latestOwn && latestCounterpart) {
          focusBothLocations(
            latestOwn,
            latestCounterpart,
            latestSheetOpen,
            false,
          );
        } else {
          const location = latestOwn ?? latestCounterpart;
          if (location) {
            mapRef.current?.animateToRegion(
              toVisibleRegion(location, latestSheetOpen),
              0,
            );
          } else if (initialHadLocationRef.current) {
            mapRef.current?.animateToRegion(DEFAULT_REGION, 0);
          }
        }
      }}
      provider={PROVIDER_GOOGLE}
      showsMyLocationButton={false}
      showsUserLocation={false}
      style={StyleSheet.absoluteFill}
    >
      {ownLocation ? (
        <Marker
          coordinate={ownLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          title="Your location"
        >
          <View style={styles.marker}>
            <View style={[styles.markerDot, styles.orderMarkerDot]} />
          </View>
        </Marker>
      ) : null}
      {counterpartLocation ? (
        <Marker
          coordinate={counterpartLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          title={mode === 'dapper' ? 'UberDap user' : 'Matched dapper'}
        >
          <View style={styles.marker}>
            <View style={[styles.markerDot, styles.counterpartMarkerDot]} />
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#ffffff',
  },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  orderMarkerDot: {
    backgroundColor: '#000000',
  },
  counterpartMarkerDot: {
    backgroundColor: '#314b9a',
  },
});

export default memo(MapSurface);
