import { useEffect, useRef } from 'react';
import MapView, { Marker, type Region } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';

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

export type MapSurfaceProps = {
  location: Coordinates | null;
  mode: AppMode;
};

export default function MapSurface({ location, mode }: MapSurfaceProps) {
  const mapRef = useRef<MapView>(null);
  const isMapReadyRef = useRef(false);
  const initialHadLocationRef = useRef(Boolean(location));
  const hadLocationRef = useRef(Boolean(location));
  const initialRegionRef = useRef<Region>(
    location ? toActiveRegion(location) : DEFAULT_REGION,
  );
  const latestLocationRef = useRef<Coordinates | null>(location);
  latestLocationRef.current = location;

  const latitude = location?.latitude;
  const longitude = location?.longitude;

  useEffect(() => {
    if (latitude !== undefined && longitude !== undefined) {
      if (isMapReadyRef.current) {
        mapRef.current?.animateToRegion(
          toActiveRegion({ latitude, longitude }),
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
  }, [latitude, longitude]);

  return (
    <MapView
      ref={mapRef}
      initialRegion={initialRegionRef.current}
      onMapReady={() => {
        isMapReadyRef.current = true;
        if (latestLocationRef.current) {
          mapRef.current?.animateToRegion(
            toActiveRegion(latestLocationRef.current),
            0,
          );
        } else if (initialHadLocationRef.current) {
          mapRef.current?.animateToRegion(DEFAULT_REGION, 0);
        }
      }}
      showsMyLocationButton={false}
      showsUserLocation={false}
      style={StyleSheet.absoluteFill}
    >
      {location ? (
        <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.marker}>
            <View
              style={[
                styles.markerDot,
                mode === 'dapper' ? styles.dapperMarkerDot : styles.orderMarkerDot,
              ]}
            />
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
  dapperMarkerDot: {
    backgroundColor: '#314b9a',
  },
});
