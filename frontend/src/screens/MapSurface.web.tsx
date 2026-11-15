import { memo } from 'react';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { StyleSheet } from 'react-native';

import 'leaflet/dist/leaflet.css';

import type { AppMode } from '../api/auth';

export type MapSurfaceProps = {
  location: {
    latitude: number;
    longitude: number;
  };
  mode: AppMode;
};

function MapSurface({ location, mode }: MapSurfaceProps) {
  const center: LatLngExpression = [location.latitude, location.longitude];
  const markerFillColor = mode === 'dapper' ? '#314b9a' : '#000000';

  return (
    <MapContainer center={center} zoom={16} style={styles.map}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CircleMarker
        center={center}
        pathOptions={{
          color: '#ffffff',
          fillColor: markerFillColor,
          fillOpacity: 1,
          weight: 5,
        }}
        radius={13}
      />
    </MapContainer>
  );
}

const styles = StyleSheet.create({
  map: {
    height: '100%',
    width: '100%',
  },
});

export default memo(MapSurface);
