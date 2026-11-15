import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { StyleSheet } from 'react-native';

import 'leaflet/dist/leaflet.css';

type UserMapSurfaceProps = {
  location: {
    latitude: number;
    longitude: number;
  };
};

export default function UserMapSurface({ location }: UserMapSurfaceProps) {
  const center: LatLngExpression = [location.latitude, location.longitude];

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
          fillColor: '#000000',
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
