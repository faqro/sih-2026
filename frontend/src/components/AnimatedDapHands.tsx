import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

export type AnimatedDapHandsHandle = {
  triggerDap: () => Promise<void>;
  reset: () => void;
};

export type AnimatedDapHandsProps = {
  initialClasped?: boolean;
  onDapComplete?: () => void;
  style?: StyleProp<ViewStyle>;
};

const AnimatedDapHands = forwardRef<AnimatedDapHandsHandle, AnimatedDapHandsProps>(
  ({ initialClasped = false, onDapComplete, style }, ref) => {
    const [isClasped, setIsClasped] = useState(initialClasped);
    const [isAnimating, setIsAnimating] = useState(false);

    // Continuous progress value (0 = Open, 1 = Closed)
    const progress = useRef(new Animated.Value(initialClasped ? 1 : 0)).current;

    function reset() {
      setIsClasped(false);
      setIsAnimating(false);
      Animated.timing(progress, {
        toValue: 0,
        duration: 380,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      }).start();
    }

    function triggerDap(): Promise<void> {
      if (isAnimating || isClasped) {
        return Promise.resolve();
      }

      setIsAnimating(true);

      return new Promise<void>((resolve) => {
        Animated.timing(progress, {
          toValue: 1,
          duration: 400,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) {
            setIsClasped(true);
            setIsAnimating(false);
            onDapComplete?.();
            resolve();
          }
        });
      });
    }

    useImperativeHandle(ref, () => ({
      triggerDap,
      reset,
    }));

    // Smooth inward glide
    const leftTranslateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 34],
    });

    const rightTranslateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -34],
    });

    // Seamless crossfade between open and closed hands (strictly 1:1 scale, zero recoil or jumping)
    const openHandsOpacity = progress.interpolate({
      inputRange: [0, 0.45, 0.8, 1],
      outputRange: [1, 1, 0, 0],
    });

    const closedHandsOpacity = progress.interpolate({
      inputRange: [0, 0.45, 0.8, 1],
      outputRange: [0, 0, 1, 1],
    });

    return (
      <Pressable
        accessibilityLabel="UberDaps hand illustration"
        accessibilityRole="image"
        onPress={() => {
          if (isClasped) {
            reset();
          } else {
            void triggerDap();
          }
        }}
        style={[styles.container, style]}
      >
        <View style={styles.stage}>
          {/* OPEN HANDS LAYER */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.openHandsLayer,
              { opacity: openHandsOpacity },
            ]}
          >
            {/* Left Hand */}
            <Animated.View
              style={[
                styles.leftHandWrapper,
                { transform: [{ translateX: leftTranslateX }] },
              ]}
            >
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={require('../../assets/dap-hand-left.png')}
                style={styles.handImage}
              />
            </Animated.View>

            {/* Right Hand */}
            <Animated.View
              style={[
                styles.rightHandWrapper,
                { transform: [{ translateX: rightTranslateX }] },
              ]}
            >
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={require('../../assets/dap-hand-right.png')}
                style={styles.handImage}
              />
            </Animated.View>
          </Animated.View>

          {/* CLOSED HANDS LAYER */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.closedHandsLayer,
              { opacity: closedHandsOpacity },
            ]}
          >
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="contain"
              source={require('../../assets/dap-hands-clasped.png')}
              style={styles.handImage}
            />
          </Animated.View>
        </View>
      </Pressable>
    );
  },
);

AnimatedDapHands.displayName = 'AnimatedDapHands';

export default AnimatedDapHands;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 942 / 298,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stage: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  openHandsLayer: {
    flexDirection: 'row',
  },
  leftHandWrapper: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '50%',
  },
  rightHandWrapper: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '50.3%',
  },
  closedHandsLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  handImage: {
    width: '100%',
    height: '100%',
  },
});
