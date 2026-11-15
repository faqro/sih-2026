import { Image, StyleSheet } from 'react-native';

type BrandLogoProps = {
  size: number;
};

export default function BrandLogo({ size }: BrandLogoProps) {
  return (
    <Image
      accessibilityLabel="UberDaps logo"
      resizeMode="contain"
      source={require('../../assets/UberDaps-v1.jpg')}
      style={[styles.logo, { width: size, height: size }]}
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    backgroundColor: '#000000',
  },
});
