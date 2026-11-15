import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

type UserMapSurfaceProps = {
  location: {
    latitude: number;
    longitude: number;
  };
};

export default function UserMapSurface({ location }: UserMapSurfaceProps) {
  const west = location.longitude - 0.015;
  const south = location.latitude - 0.008;
  const east = location.longitude + 0.015;
  const north = location.latitude + 0.008;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik`;

  return (
    <View style={StyleSheet.absoluteFill}>
      {createElement('iframe', {
        title: 'Map centered on your location',
        src: mapUrl,
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 0,
        },
      })}
      <View pointerEvents="none" style={styles.marker}>
        <View style={styles.markerDot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  marker: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    marginTop: -13,
    marginLeft: -13,
    backgroundColor: '#ffffff',
  },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#000000',
  },
});
