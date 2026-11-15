import { memo, useEffect, useRef } from 'react';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
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
  canPinLocation?: boolean;
  onSelectLocation?: (coordinates: Coordinates) => void;
};

function MapClickHandler({
  canPinLocation,
  onSelectLocation,
}: {
  canPinLocation: boolean;
  onSelectLocation?: (coordinates: Coordinates) => void;
}) {
  useMapEvents({
    click(event) {
      if (canPinLocation && onSelectLocation) {
        onSelectLocation({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        });
      }
    },
  });

  return null;
}

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
      const targetZoom = Math.max(map.getZoom(), ACTIVE_ZOOM);
      map.setView([location.latitude, location.longitude], targetZoom);
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
  .leaflet-container {
    background: #f4f4f4 !important;
  }
  .leaflet-tile-pane {
    filter: grayscale(100%) contrast(110%) brightness(100%);
    -webkit-filter: grayscale(100%) contrast(110%) brightness(100%);
  }
  .leaflet-control-attribution {
    display: none !important;
  }
`;

function MapSurface({
  ownLocation,
  counterpartLocation,
  isSheetOpen,
  canPinLocation = false,
  onSelectLocation,
}: MapSurfaceProps) {
  const initialLocation = ownLocation ?? counterpartLocation;
  const initialCenter: LatLngExpression = initialLocation
    ? [initialLocation.latitude, initialLocation.longitude]
    : DEFAULT_CENTER;
  const initialZoom = initialLocation ? ACTIVE_ZOOM : DEFAULT_ZOOM;

  return (
    <MapContainer
      attributionControl={false}
      center={initialCenter}
      zoom={initialZoom}
      zoomControl={false}
      style={{
        height: '100%',
        width: '100%',
        cursor: canPinLocation ? 'crosshair' : undefined,
      }}
    >
      <style>{UBER_BW_TILE_CSS}</style>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler
        canPinLocation={canPinLocation}
        onSelectLocation={onSelectLocation}
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
