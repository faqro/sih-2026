import { memo, useEffect, useRef } from 'react';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type MapStyleElement,
  type Region,
} from 'react-native-maps';
import { StyleSheet, useWindowDimensions } from 'react-native';

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

function toPairRegion(
  first: Coordinates,
  second: Coordinates,
  viewportWidth: number,
  viewportHeight: number,
  sheetOpen: boolean,
): Region {
  const longitudeDifference =
    ((second.longitude - first.longitude + 540) % 360) - 180;
  const latitudeDifference = second.latitude - first.latitude;
  const latitudeSpan = Math.max(Math.abs(latitudeDifference), 0.008);
  const longitudeSpan = Math.max(Math.abs(longitudeDifference), 0.008);
  const visibleHeight = sheetOpen ? viewportHeight / 2 : viewportHeight;
  const aspectRatio = viewportWidth / Math.max(visibleHeight, 1);
  const spanMultiplier = sheetOpen ? 2.3 : 1.4;
  const latitudeDelta = Math.min(
    170,
    Math.max(
      latitudeSpan * spanMultiplier,
      (longitudeSpan / aspectRatio) * 1.4,
    ),
  );
  const longitudeDelta = Math.min(
    360,
    Math.max(
      longitudeSpan * 1.4,
      latitudeSpan * aspectRatio * spanMultiplier,
    ),
  );
  const midpointLatitude = (first.latitude + second.latitude) / 2;
  const midpointLongitude = first.longitude + longitudeDifference / 2;

  return {
    latitude:
      midpointLatitude - (sheetOpen ? latitudeDelta * 0.25 : 0),
    longitude: ((midpointLongitude + 540) % 360) - 180,
    latitudeDelta,
    longitudeDelta,
  };
}

const minimalMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3f4f6' }] },
  { featureType: 'administrative', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#dadada' }],
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
    stylers: [{ color: '#d0d0d0' }],
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
  const { height: viewportHeight, width: viewportWidth } =
    useWindowDimensions();
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
    mapRef.current?.animateToRegion(
      toPairRegion(
        first,
        second,
        viewportWidth,
        viewportHeight,
        sheetOpen,
      ),
      animated ? 350 : 0,
    );
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
          pinColor="#000000"
          title="Your location"
        />
      ) : null}
      {counterpartLocation ? (
        <Marker
          coordinate={counterpartLocation}
          pinColor="#314b9a"
          title={mode === 'dapper' ? 'UberDap user' : 'Matched dapper'}
        />
      ) : null}
    </MapView>
  );
}

export default memo(MapSurface);
