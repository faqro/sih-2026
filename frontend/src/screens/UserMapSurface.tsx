import MapView, { Marker, type Region } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';

type UserMapSurfaceProps = {
  location: {
    latitude: number;
    longitude: number;
  };
};

export default function UserMapSurface({ location }: UserMapSurfaceProps) {
  const region: Region = {
    ...location,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  };

  return (
    <MapView region={region} style={StyleSheet.absoluteFill}>
      <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }}>
        <View style={styles.marker}>
          <View style={styles.markerDot} />
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
    backgroundColor: '#000000',
  },
});
