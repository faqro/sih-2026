import { memo } from 'react';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type MapStyleElement,
  type Region,
} from 'react-native-maps';
import { StyleSheet, View } from 'react-native';

import type { AppMode } from '../api/auth';

export type MapSurfaceProps = {
  location: {
    latitude: number;
    longitude: number;
  };
  mode: AppMode;
};

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

function MapSurface({ location, mode }: MapSurfaceProps) {
  const region: Region = {
    ...location,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  };

  return (
    <MapView
      customMapStyle={minimalMapStyle}
      provider={PROVIDER_GOOGLE}
      region={region}
      style={StyleSheet.absoluteFill}
    >
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

export default memo(MapSurface);
