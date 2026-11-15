import { memo, useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { StyleSheet } from 'react-native';

import 'leaflet/dist/leaflet.css';

import type { AppMode } from '../api/auth';
import {
  DEFAULT_MAP_COORDINATES,
  type Coordinates,
} from '../location/dapperLocation';

const DEFAULT_CENTER: LatLngExpression = [
  DEFAULT_MAP_COORDINATES.latitude,
  DEFAULT_MAP_COORDINATES.longitude,
];
const DEFAULT_ZOOM = 4;
const ACTIVE_ZOOM = 16;

export type MapSurfaceProps = {
  location: Coordinates | null;
  mode: AppMode;
};

function MapViewportController({
  location,
}: {
  location: Coordinates | null;
}) {
  const map = useMap();
  const hadLocationRef = useRef(Boolean(location));
  const latitude = location?.latitude;
  const longitude = location?.longitude;

  useEffect(() => {
    if (latitude !== undefined && longitude !== undefined) {
      map.setView([latitude, longitude], ACTIVE_ZOOM);
      hadLocationRef.current = true;
    } else if (hadLocationRef.current) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      hadLocationRef.current = false;
    }
  }, [latitude, longitude, map]);

  return null;
}

function MapSurface({ location, mode }: MapSurfaceProps) {
  const initialCenter: LatLngExpression = location
    ? [location.latitude, location.longitude]
    : DEFAULT_CENTER;
  const initialZoom = location ? ACTIVE_ZOOM : DEFAULT_ZOOM;
  const markerFillColor = mode === 'dapper' ? '#314b9a' : '#000000';

  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      zoomControl={false}
      style={styles.map}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapViewportController location={location} />
      {location ? (
        <CircleMarker
          center={[location.latitude, location.longitude]}
          pathOptions={{
            color: '#ffffff',
            fillColor: markerFillColor,
            fillOpacity: 1,
            weight: 5,
          }}
          radius={13}
        />
      ) : null}
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
