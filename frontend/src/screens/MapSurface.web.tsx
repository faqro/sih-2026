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
  ownLocation: Coordinates | null;
  counterpartLocation: Coordinates | null;
  isSheetOpen: boolean;
  mode: AppMode;
};

function MapViewportController({
  ownLocation,
  counterpartLocation,
  isSheetOpen,
}: {
  ownLocation: Coordinates | null;
  counterpartLocation: Coordinates | null;
  isSheetOpen: boolean;
}) {
  const map = useMap();
  const hadLocationRef = useRef(Boolean(ownLocation || counterpartLocation));

  useEffect(() => {
    if (ownLocation && counterpartLocation) {
      if (
        Math.abs(ownLocation.latitude - counterpartLocation.latitude) < 0.001 &&
        Math.abs(ownLocation.longitude - counterpartLocation.longitude) < 0.001
      ) {
        map.setView(
          [ownLocation.latitude, ownLocation.longitude],
          ACTIVE_ZOOM,
        );
        if (isSheetOpen) {
          map.panBy([0, Math.floor(map.getSize().y / 4)], { animate: false });
        }
      } else {
        map.fitBounds(
          [
            [ownLocation.latitude, ownLocation.longitude],
            [counterpartLocation.latitude, counterpartLocation.longitude],
          ],
          {
            paddingTopLeft: [64, 64],
            paddingBottomRight: [
              64,
              isSheetOpen ? Math.floor(map.getSize().y / 2) + 32 : 64,
            ],
            maxZoom: ACTIVE_ZOOM,
          },
        );
      }
      hadLocationRef.current = true;
      return;
    }
    const location = ownLocation ?? counterpartLocation;
    if (location) {
      map.setView([location.latitude, location.longitude], ACTIVE_ZOOM);
      if (isSheetOpen) {
        map.panBy([0, Math.floor(map.getSize().y / 4)], { animate: false });
      }
      hadLocationRef.current = true;
    } else if (hadLocationRef.current) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      hadLocationRef.current = false;
    }
  }, [
    ownLocation?.latitude,
    ownLocation?.longitude,
    counterpartLocation?.latitude,
    counterpartLocation?.longitude,
    isSheetOpen,
    map,
  ]);

  return null;
}

const UBER_BW_TILE_CSS = `
  .leaflet-tile-pane {
    filter: grayscale(100%) contrast(106%) brightness(98%);
    -webkit-filter: grayscale(100%) contrast(106%) brightness(98%);
  }
`;

function MapSurface({
  ownLocation,
  counterpartLocation,
  isSheetOpen,
}: MapSurfaceProps) {
  const initialLocation = ownLocation ?? counterpartLocation;
  const initialCenter: LatLngExpression = initialLocation
    ? [initialLocation.latitude, initialLocation.longitude]
    : DEFAULT_CENTER;
  const initialZoom = initialLocation ? ACTIVE_ZOOM : DEFAULT_ZOOM;

  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      zoomControl={false}
      style={styles.map}
    >
      <style>{UBER_BW_TILE_CSS}</style>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <MapViewportController
        ownLocation={ownLocation}
        counterpartLocation={counterpartLocation}
        isSheetOpen={isSheetOpen}
      />
      {ownLocation ? (
        <CircleMarker
          center={[ownLocation.latitude, ownLocation.longitude]}
          pathOptions={{
            color: '#ffffff',
            fillColor: '#000000',
            fillOpacity: 1,
            weight: 5,
          }}
          radius={13}
        />
      ) : null}
      {counterpartLocation ? (
        <CircleMarker
          center={[
            counterpartLocation.latitude,
            counterpartLocation.longitude,
          ]}
          pathOptions={{
            color: '#ffffff',
            fillColor: '#000000',
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
