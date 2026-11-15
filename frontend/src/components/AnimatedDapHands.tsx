import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
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

function playSlapSound() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // High frequency slap pop into low thud
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(280, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.14);

        gain.gain.setValueAtTime(0.7, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.14);
      }
    } catch {
      // AudioContext may be restricted by browser policy before user interaction
    }
  }
}

const AnimatedDapHands = forwardRef<AnimatedDapHandsHandle, AnimatedDapHandsProps>(
  ({ initialClasped = false, onDapComplete, style }, ref) => {
    const [isClasped, setIsClasped] = useState(initialClasped);
    const [isAnimating, setIsAnimating] = useState(false);

    // Transforms
    const leftTranslateX = useRef(new Animated.Value(0)).current;
    const rightTranslateX = useRef(new Animated.Value(0)).current;
    const openHandsOpacity = useRef(new Animated.Value(initialClasped ? 0 : 1)).current;

    const claspedScale = useRef(new Animated.Value(initialClasped ? 1 : 0.9)).current;
    const claspedOpacity = useRef(new Animated.Value(initialClasped ? 1 : 0)).current;

    const shockwaveScale = useRef(new Animated.Value(0.2)).current;
    const shockwaveOpacity = useRef(new Animated.Value(0)).current;
    const shakeX = useRef(new Animated.Value(0)).current;

    // Sparks
    const sparksScale = useRef(new Animated.Value(0)).current;
    const sparksOpacity = useRef(new Animated.Value(0)).current;

    function reset() {
      setIsClasped(false);
      setIsAnimating(false);
      leftTranslateX.setValue(0);
      rightTranslateX.setValue(0);
      openHandsOpacity.setValue(1);
      claspedScale.setValue(0.9);
      claspedOpacity.setValue(0);
      shockwaveScale.setValue(0.2);
      shockwaveOpacity.setValue(0);
      shakeX.setValue(0);
      sparksScale.setValue(0);
      sparksOpacity.setValue(0);
    }

    function triggerDap(): Promise<void> {
      if (isAnimating || isClasped) {
        return Promise.resolve();
      }

      setIsAnimating(true);

      return new Promise<void>((resolve) => {
        // Step 1: Pull back (anticipation: 75ms)
        Animated.parallel([
          Animated.timing(leftTranslateX, {
            toValue: -8,
            duration: 75,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(rightTranslateX, {
            toValue: 8,
            duration: 75,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Step 2: High velocity strike towards each other (140ms)
          Animated.parallel([
            Animated.timing(leftTranslateX, {
              toValue: 40,
              duration: 140,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(rightTranslateX, {
              toValue: -40,
              duration: 140,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
          ]).start(() => {
            // STEP 3: THE IMPACT MOMENT!
            playSlapSound();

            // Swap visibility
            openHandsOpacity.setValue(0);
            claspedOpacity.setValue(1);
            setIsClasped(true);

            // Shockwave setup
            shockwaveScale.setValue(0.25);
            shockwaveOpacity.setValue(1);
            sparksScale.setValue(0.2);
            sparksOpacity.setValue(1);

            // Parallel impact recoil, shockwave expansion, and screen shake
            Animated.parallel([
              // Clasped hand firm recoil spring
              Animated.sequence([
                Animated.timing(claspedScale, {
                  toValue: 1.08,
                  duration: 60,
                  useNativeDriver: true,
                }),
                Animated.spring(claspedScale, {
                  toValue: 1.0,
                  useNativeDriver: true,
                  bounciness: 12,
                  speed: 20,
                }),
              ]),

              // Acoustic Shockwave burst
              Animated.timing(shockwaveScale, {
                toValue: 2.8,
                duration: 280,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(shockwaveOpacity, {
                toValue: 0,
                duration: 280,
                useNativeDriver: true,
              }),

              // Radial sparks
              Animated.timing(sparksScale, {
                toValue: 2.2,
                duration: 220,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(sparksOpacity, {
                toValue: 0,
                duration: 220,
                useNativeDriver: true,
              }),

              // Horizontal tactile shake
              Animated.sequence([
                Animated.timing(shakeX, { toValue: -6, duration: 25, useNativeDriver: true }),
                Animated.timing(shakeX, { toValue: 6, duration: 25, useNativeDriver: true }),
                Animated.timing(shakeX, { toValue: -3, duration: 25, useNativeDriver: true }),
                Animated.timing(shakeX, { toValue: 3, duration: 25, useNativeDriver: true }),
                Animated.timing(shakeX, { toValue: 0, duration: 25, useNativeDriver: true }),
              ]),
            ]).start(() => {
              setIsAnimating(false);
              onDapComplete?.();
              resolve();
            });
          });
        });
      });
    }

    useImperativeHandle(ref, () => ({
      triggerDap,
      reset,
    }));

    return (
      <Pressable
        accessibilityLabel="UberDaps interactive hand illustration"
        accessibilityRole="image"
        onPress={() => void triggerDap()}
        style={[styles.container, style]}
      >
        <Animated.View
          style={[
            styles.stage,
            { transform: [{ translateX: shakeX }] },
          ]}
        >
          {/* OPEN HANDS (Two parts animating inward) */}
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
              <Animated.Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={require('../../assets/dap-hand-left.png')}
                style={styles.leftHandImage}
              />
            </Animated.View>

            {/* Right Hand */}
            <Animated.View
              style={[
                styles.rightHandWrapper,
                { transform: [{ translateX: rightTranslateX }] },
              ]}
            >
              <Animated.Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={require('../../assets/dap-hand-right.png')}
                style={styles.rightHandImage}
              />
            </Animated.View>
          </Animated.View>

          {/* CLOSED / CLASPED HANDS */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.claspedHandsLayer,
              {
                opacity: claspedOpacity,
                transform: [{ scale: claspedScale }],
              },
            ]}
          >
            <Animated.Image
              accessibilityIgnoresInvertColors
              resizeMode="contain"
              source={require('../../assets/dap-hands-clasped.png')}
              style={styles.claspedImage}
            />
          </Animated.View>

          {/* IMPACT SHOCKWAVE RING */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shockwaveRing,
              {
                opacity: shockwaveOpacity,
                transform: [{ scale: shockwaveScale }],
              },
            ]}
          />

          {/* IMPACT SPARKS */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sparksContainer,
              {
                opacity: sparksOpacity,
                transform: [{ scale: sparksScale }],
              },
            ]}
          >
            <View style={[styles.sparkDot, styles.sparkTop]} />
            <View style={[styles.sparkDot, styles.sparkBottom]} />
            <View style={[styles.sparkDot, styles.sparkLeft]} />
            <View style={[styles.sparkDot, styles.sparkRight]} />
          </Animated.View>
        </Animated.View>
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
    overflow: 'visible',
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
  leftHandImage: {
    width: '100%',
    height: '100%',
  },
  rightHandWrapper: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '50.3%',
  },
  rightHandImage: {
    width: '100%',
    height: '100%',
  },
  claspedHandsLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  claspedImage: {
    width: '100%',
    height: '100%',
  },
  shockwaveRing: {
    position: 'absolute',
    left: '49%',
    top: '46%',
    width: 70,
    height: 70,
    marginLeft: -35,
    marginTop: -35,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: '#000000',
  },
  sparksContainer: {
    position: 'absolute',
    left: '49%',
    top: '46%',
    width: 60,
    height: 60,
    marginLeft: -30,
    marginTop: -30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#000000',
  },
  sparkTop: {
    top: 0,
  },
  sparkBottom: {
    bottom: 0,
  },
  sparkLeft: {
    left: 0,
  },
  sparkRight: {
    right: 0,
  },
});
