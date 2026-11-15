import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

type DapMinigameProps = {
  dapperName: string;
  dapTier: string;
  onClose: () => void;
};

type ResultTier = {
  label: string;
  score: number;
  description: string;
  color: string;
  badge: string;
};

export default function DapMinigame({
  dapperName,
  dapTier,
  onClose,
}: DapMinigameProps) {
  const [hasHit, setHasHit] = useState(false);
  const [result, setResult] = useState<ResultTier | null>(null);

  // Oscillating needle animation (0 -> 1 -> 0)
  const needleAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Shockwave & shake animations
  const shockwaveScale = useRef(new Animated.Value(0)).current;
  const shockwaveOpacity = useRef(new Animated.Value(1)).current;
  const shakeX = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.92)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Card entrance
    Animated.parallel([
      Animated.spring(cardScale, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 8,
        speed: 16,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    // Start oscillating needle
    startNeedleAnimation();

    return () => {
      loopRef.current?.stop();
    };
  }, []);

  function startNeedleAnimation() {
    needleAnim.setValue(0);
    loopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(needleAnim, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(needleAnim, {
          toValue: 0,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loopRef.current.start();
  }

  function handleHit() {
    if (hasHit) return;
    setHasHit(true);

    // Stop needle and get current position value
    loopRef.current?.stop();

    // In Animated without listener, we can capture approximate pos or randomize around sweet spot for excitement
    const needleVal = (needleAnim as any)._value ?? Math.random();
    const distFromCenter = Math.abs(needleVal - 0.5); // 0 (perfect) to 0.5 (far)
    const accuracy = Math.max(0, Math.min(100, Math.round((1 - distFromCenter / 0.5) * 100)));

    let hitResult: ResultTier;
    if (accuracy >= 85) {
      hitResult = {
        label: 'PERFECT DAP! 💯',
        score: 100,
        description:
          'Absolute legendary crispness. The acoustic resonance echoed 3 blocks away. Dapper nods in pure reverence.',
        color: '#B3EEC9',
        badge: 'MASTERCLASS',
      };
    } else if (accuracy >= 60) {
      hitResult = {
        label: 'SOLID DAP! 👏',
        score: accuracy,
        description:
          'Crisp palm contact with respectable sound volume. Good friction, zero finger fumbling.',
        color: '#FAC8B8',
        badge: 'RESPECTABLE',
      };
    } else {
      hitResult = {
        label: 'SLIGHT MISS! 😬',
        score: accuracy,
        description:
          'Slightly awkward thumb clash. Good enthusiasm, but practice is required to reach the hall of fame.',
        color: '#ACB2BE',
        badge: 'NEED PRACTICE',
      };
    }
    setResult(hitResult);

    // Trigger explosive shockwave and screen shake
    shockwaveScale.setValue(0.5);
    shockwaveOpacity.setValue(1);

    Animated.parallel([
      Animated.timing(shockwaveScale, {
        toValue: 3.5,
        duration: 650,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(shockwaveOpacity, {
        toValue: 0,
        duration: 650,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(shakeX, { toValue: -12, duration: 40, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 12, duration: 40, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -8, duration: 40, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 8, duration: 40, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0, duration: 40, useNativeDriver: true }),
      ]),
    ]).start();
  }

  function handleReset() {
    setHasHit(false);
    setResult(null);
    startNeedleAnimation();
  }

  // Map needle 0 -> 1 to translate X across track (track is 280px wide, needle is 8px)
  const needleTranslateX = needleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 272],
  });

  return (
    <View style={styles.overlay}>
      <Animated.View
        style={[
          styles.modalContainer,
          {
            opacity: cardOpacity,
            transform: [{ scale: cardScale }, { translateX: shakeX }],
          },
        ]}
      >
        {/* Shockwave ring */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shockwave,
            {
              transform: [{ scale: shockwaveScale }],
              opacity: shockwaveOpacity,
            },
          ]}
        />

        {/* Modal Header */}
        <View style={styles.header}>
          <Text style={styles.kicker}>THE DAP ZONE</Text>
          <Text style={styles.title}>{dapTier} Impact</Text>
          <Text style={styles.subtext}>
            Align with <Text style={styles.bold}>{dapperName}</Text> for the crispest clap.
          </Text>
        </View>

        {/* Meter Bar Section */}
        <View style={styles.meterSection}>
          <View style={styles.meterLabels}>
            <Text style={styles.meterSub}>LIMP</Text>
            <Text style={styles.meterSweet}>SWEET SPOT</Text>
            <Text style={styles.meterSub}>LIMP</Text>
          </View>

          <View style={styles.meterTrack}>
            {/* Left flank */}
            <View style={styles.meterFlank} />
            {/* Center sweet zone */}
            <View style={styles.meterSweetZone} />
            {/* Right flank */}
            <View style={styles.meterFlank} />

            {/* Needle */}
            <Animated.View
              style={[
                styles.needle,
                {
                  transform: [{ translateX: needleTranslateX }],
                },
              ]}
            />
          </View>
        </View>

        {/* Hit Result Feedback */}
        {result ? (
          <View style={styles.resultBox}>
            <View style={[styles.badgePill, { backgroundColor: result.color }]}>
              <Text style={styles.badgeText}>{result.badge}</Text>
            </View>
            <Text style={styles.resultLabel}>{result.label}</Text>
            <Text style={styles.scoreText}>{result.score}% RESONANCE</Text>
            <Text style={styles.resultDesc}>{result.description}</Text>
          </View>
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          {!hasHit ? (
            <Pressable
              accessibilityRole="button"
              onPress={handleHit}
              style={({ pressed }) => [
                styles.slapButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.slapButtonText}>💥 SLAP DAP!</Text>
            </Pressable>
          ) : (
            <View style={styles.completedActions}>
              <Pressable
                accessibilityRole="button"
                onPress={handleReset}
                style={({ pressed }) => [
                  styles.againButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.againButtonText}>Dap Again</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.finishButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.finishButtonText}>Rate 5 Stars ⭐</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 2000,
    elevation: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
    overflow: 'hidden',
  },
  shockwave: {
    position: 'absolute',
    top: '35%',
    left: '35%',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 6,
    borderColor: '#B3EEC9',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  kicker: {
    color: '#777777',
    fontFamily: displayFontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtext: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  bold: {
    fontWeight: '700',
    color: '#000000',
  },
  meterSection: {
    width: 280,
    alignItems: 'center',
    marginVertical: 12,
  },
  meterLabels: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  meterSub: {
    color: '#888888',
    fontFamily: displayFontFamily,
    fontSize: 11,
    fontWeight: '600',
  },
  meterSweet: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  meterTrack: {
    width: 280,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ececec',
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
  },
  meterFlank: {
    flex: 1,
    backgroundColor: '#ececec',
  },
  meterSweetZone: {
    width: 72,
    backgroundColor: '#B3EEC9',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#8ce2aa',
  },
  needle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 8,
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  resultBox: {
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  badgePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  badgeText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  resultLabel: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  scoreText: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
    marginVertical: 4,
  },
  resultDesc: {
    color: '#444444',
    fontFamily: displayFontFamily,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  actions: {
    width: '100%',
    marginTop: 20,
  },
  slapButton: {
    width: '100%',
    height: 54,
    borderRadius: 14,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  slapButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  completedActions: {
    width: '100%',
    gap: 10,
  },
  againButton: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    backgroundColor: '#ececec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  againButtonText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  finishButton: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.88,
  },
});
