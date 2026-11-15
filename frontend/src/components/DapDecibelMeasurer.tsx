import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

const displayFontFamily = Platform.select({
  web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  default: undefined,
});

export type DapDecibelMeasurerProps = {
  dapperName?: string | null;
  dapperUsername?: string | null;
  dapperRating?: number | null;
  dapperRatingCount?: number | null;
  targetDb?: number;
  onSuccessfulDap?: (peakDb: number) => void;
  onProceedToRating?: () => void;
  style?: StyleProp<ViewStyle>;
};

const BAR_COUNT = 24;
const MIN_DB = 30;
const MAX_DB = 100;
const DEFAULT_TARGET_DB = 85;

export default function DapDecibelMeasurer({
  dapperName,
  dapperUsername,
  dapperRating,
  dapperRatingCount,
  targetDb = DEFAULT_TARGET_DB,
  onSuccessfulDap,
  onProceedToRating,
  style,
}: DapDecibelMeasurerProps) {
  const [currentDb, setCurrentDb] = useState(MIN_DB);
  const [peakDb, setPeakDb] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micPermission, setMicPermission] = useState<
    'idle' | 'listening' | 'denied' | 'unsupported'
  >('idle');
  const [barHeights, setBarHeights] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 6),
  );
  const [tapCount, setTapCount] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const peakDbRef = useRef(0);
  const isSuccessRef = useRef(false);
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pulse animation for success
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Initialize and clean up AudioContext
  useEffect(() => {
    peakDbRef.current = peakDb;
  }, [peakDb]);

  useEffect(() => {
    isSuccessRef.current = isSuccess;
  }, [isSuccess]);

  useEffect(() => {
    // Attempt auto-start listening on web if supported
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      void initAudio();
    }

    return () => {
      stopAudio();
      if (decayTimeoutRef.current) {
        clearTimeout(decayTimeoutRef.current);
      }
    };
  }, []);

  async function initAudio() {
    if (
      typeof window === 'undefined' ||
      !window.navigator?.mediaDevices?.getUserMedia
    ) {
      setMicPermission('unsupported');
      return;
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      mediaStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;

      if (!AudioCtx) {
        setMicPermission('unsupported');
        return;
      }

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsListening(true);
      setMicPermission('listening');
      startAnalysisLoop();
    } catch {
      setMicPermission('denied');
      setIsListening(false);
    }
  }

  function stopAudio() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setIsListening(false);
  }

  function startAnalysisLoop() {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function analyze() {
      const activeAnalyser = analyserRef.current;
      if (!activeAnalyser) return;

      activeAnalyser.getByteFrequencyData(dataArray);

      // Calculate instantaneous energy / amplitude
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;

      // Map average (0 - 255) to dB scale (approx 30 - 100 dB)
      const normalizedAmp = Math.min(1, average / 160);
      const computedDb = Math.round(MIN_DB + normalizedAmp * (MAX_DB - MIN_DB));

      setCurrentDb(computedDb);

      // Generate waveform bar heights (min 6px, max 50px)
      const step = Math.max(1, Math.floor(dataArray.length / BAR_COUNT));
      const nextBars: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const val = dataArray[i * step] || 0;
        const barHeight = Math.max(6, Math.min(50, Math.round((val / 255) * 44 + 6)));
        nextBars.push(barHeight);
      }
      setBarHeights(nextBars);

      // Update peak
      if (computedDb > peakDbRef.current) {
        peakDbRef.current = computedDb;
        setPeakDb(computedDb);

        if (computedDb >= targetDb && !isSuccessRef.current) {
          triggerSuccess(computedDb);
        }
      }

      animationFrameRef.current = requestAnimationFrame(analyze);
    }

    animationFrameRef.current = requestAnimationFrame(analyze);
  }

  function triggerSuccess(achievedDb: number) {
    setIsSuccess(true);
    isSuccessRef.current = true;
    onSuccessfulDap?.(achievedDb);

    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 1.08,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }

  // Simulated dap tap for testing without live microphone
  function handleManualDapTap() {
    const nextTap = tapCount + 1;
    setTapCount(nextTap);

    // Realistic dap loudness progression:
    // 1st tap: soft dap (62-65 dB)
    // 2nd tap: moderate dap (76-79 dB)
    // 3rd tap: crispy dap (88-92 dB - hits goal!)
    let simulatedDb: number;
    if (nextTap === 1) {
      simulatedDb = 64;
    } else if (nextTap === 2) {
      simulatedDb = 78;
    } else {
      simulatedDb = 89 + Math.floor(Math.random() * 4);
    }

    setCurrentDb(simulatedDb);

    // Generate simulated waveform spike
    const intensity = (simulatedDb - MIN_DB) / (MAX_DB - MIN_DB);
    const spikeBars = Array.from({ length: BAR_COUNT }, (_, index) => {
      const centerDist = Math.abs(index - BAR_COUNT / 2) / (BAR_COUNT / 2);
      const factor = Math.max(0.2, 1 - centerDist * 0.65);
      return Math.max(6, Math.min(50, Math.round(intensity * factor * 48 + 6)));
    });
    setBarHeights(spikeBars);

    if (simulatedDb > peakDbRef.current) {
      peakDbRef.current = simulatedDb;
      setPeakDb(simulatedDb);

      if (simulatedDb >= targetDb && !isSuccessRef.current) {
        triggerSuccess(simulatedDb);
      }
    }

    // Decay bars back to subtle ambient idle
    if (decayTimeoutRef.current) {
      clearTimeout(decayTimeoutRef.current);
    }
    decayTimeoutRef.current = setTimeout(() => {
      setCurrentDb(MIN_DB + 4);
      setBarHeights(Array.from({ length: BAR_COUNT }, () => 6 + Math.floor(Math.random() * 4)));
    }, 450);
  }

  function handleReset() {
    setIsSuccess(false);
    isSuccessRef.current = false;
    setPeakDb(0);
    peakDbRef.current = 0;
    setCurrentDb(MIN_DB);
    setTapCount(0);
    setBarHeights(Array.from({ length: BAR_COUNT }, () => 6));
  }

  // Progress percentage to target
  const progressRatio = Math.max(
    0,
    Math.min(1, (peakDb - MIN_DB) / (targetDb - MIN_DB)),
  );
  const targetThresholdRatio = (targetDb - MIN_DB) / (MAX_DB - MIN_DB);

  return (
    <View style={[styles.container, style]}>
      {/* Header Announcement */}
      <View style={styles.headerRow}>
        <Text style={styles.arrivalTitle}>Oh, your dapper is here.</Text>
        <Text style={styles.arrivalSubtitle}>
          Keep dapping until you hit the target decibel level for a crispy dap!
        </Text>
      </View>

      {/* Matched Dapper Card */}
      <View style={styles.dapperBadge}>
        <View style={styles.dapperInfo}>
          <Text style={styles.dapperName}>
            {dapperName || dapperUsername || 'Dapper'}
          </Text>
          {dapperUsername ? (
            <Text style={styles.dapperHandle}>@{dapperUsername}</Text>
          ) : null}
        </View>
        <View style={styles.ratingGroup}>
          <Text style={styles.ratingStars}>
            {dapperRatingCount === 0
              ? '★ New Dapper'
              : `★ ${(dapperRating ?? 5.0).toFixed(1)}`}
          </Text>
          {dapperRatingCount && dapperRatingCount > 0 ? (
            <Text style={styles.ratingCount}>
              ({dapperRatingCount} {dapperRatingCount === 1 ? 'rating' : 'ratings'})
            </Text>
          ) : null}
        </View>
      </View>

      {/* Decibel Measurer Box */}
      <Animated.View
        style={[
          styles.measurerBox,
          isSuccess && styles.measurerBoxSuccess,
          { transform: [{ scale: pulseAnim }] },
        ]}
      >
        {/* Readings Header */}
        <View style={styles.readingsHeader}>
          <View>
            <Text style={styles.readingsLabel}>Current Loudness</Text>
            <Text style={styles.currentDbText}>{currentDb} dB</Text>
          </View>
          <View style={styles.targetBadge}>
            <Text style={styles.targetLabel}>Target</Text>
            <Text style={styles.targetDbText}>{targetDb} dB</Text>
          </View>
        </View>

        {/* Progress Track */}
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.round(progressRatio * 100)}%` },
                isSuccess && styles.progressBarSuccess,
              ]}
            />
            {/* Target Marker Pin */}
            <View
              style={[
                styles.targetMarker,
                { left: `${Math.round(targetThresholdRatio * 100)}%` },
              ]}
            />
          </View>
          <View style={styles.progressLabels}>
            <Text style={styles.progressSubtext}>
              {peakDb > 0
                ? `Highest so far: ${peakDb} dB`
                : 'No daps recorded yet'}
            </Text>
            <Text style={styles.progressTargetSubtext}>Goal: {targetDb} dB</Text>
          </View>
        </View>

        {/* Sound Waveform with Gray Bars */}
        <View style={styles.waveformContainer}>
          <View style={styles.waveformBarsRow}>
            {barHeights.map((h, i) => {
              const isCenter = Math.abs(i - BAR_COUNT / 2) < 4;
              const isHigh = h > 20;
              return (
                <View
                  key={i}
                  style={[
                    styles.waveformBar,
                    { height: h },
                    isHigh
                      ? styles.waveformBarActive
                      : isCenter
                        ? styles.waveformBarMedium
                        : styles.waveformBarIdle,
                  ]}
                />
              );
            })}
          </View>
          {/* Target dotted line */}
          <View style={styles.waveformTargetLine} />
        </View>

        {/* Dynamic Coaching / Success Status Message */}
        <View style={styles.statusBox}>
          {isSuccess ? (
            <View style={styles.successMessageGroup}>
              <Text style={styles.successTitle}>Yes, successful dap up.</Text>
              <Text style={styles.successSubtitle}>
                Crispiness verified at {peakDb} dB! Perfect dap achieved.
              </Text>
            </View>
          ) : (
            <Text style={styles.coachingText}>
              {peakDb === 0
                ? 'Listening for your dap... Slap those hands together!'
                : peakDb < 68
                  ? `Weak dap! Highest so far: ${peakDb} dB. Dap harder!`
                  : peakDb < targetDb
                    ? `Almost there! Highest so far: ${peakDb} dB. Give it everything!`
                    : 'Yes, successful dap up.'}
            </Text>
          )}
        </View>

        {/* Action Controls */}
        <View style={styles.actionsRow}>
          {!isSuccess ? (
            <>
              <Pressable
                accessibilityLabel="Simulate or tap dap"
                accessibilityRole="button"
                onPress={handleManualDapTap}
                style={({ pressed }) => [
                  styles.dapButton,
                  pressed && styles.dapButtonPressed,
                ]}
              >
                <Text style={styles.dapButtonText}>👏 Dap Up!</Text>
              </Pressable>

              {micPermission !== 'listening' ? (
                <Pressable
                  accessibilityLabel="Enable microphone"
                  accessibilityRole="button"
                  onPress={() => void initAudio()}
                  style={styles.micButton}
                >
                  <Text style={styles.micButtonText}>Enable Mic</Text>
                </Pressable>
              ) : (
                <View style={styles.micListeningIndicator}>
                  <View style={styles.micPulsingDot} />
                  <Text style={styles.micListeningText}>Mic Listening</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.successActions}>
              {onProceedToRating ? (
                <Pressable
                  accessibilityLabel="Rate dap crispiness"
                  accessibilityRole="button"
                  onPress={onProceedToRating}
                  style={styles.rateDapButton}
                >
                  <Text style={styles.rateDapButtonText}>
                    Rate Dap Crispiness →
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                accessibilityLabel="Dap again"
                accessibilityRole="button"
                onPress={handleReset}
                style={styles.dapAgainButton}
              >
                <Text style={styles.dapAgainText}>Dap Again</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 12,
  },
  headerRow: {
    gap: 4,
    marginBottom: 4,
  },
  arrivalTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  arrivalSubtitle: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
  dapperBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#ececec',
  },
  dapperInfo: {
    gap: 2,
  },
  dapperName: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  dapperHandle: {
    color: '#888888',
    fontSize: 12,
  },
  ratingGroup: {
    alignItems: 'flex-end',
    gap: 2,
  },
  ratingStars: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  ratingCount: {
    color: '#888888',
    fontSize: 11,
  },
  measurerBox: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#ececec',
    padding: 16,
    gap: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  measurerBoxSuccess: {
    borderColor: '#000000',
    borderWidth: 2,
  },
  readingsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  readingsLabel: {
    color: '#666666',
    fontSize: 11,
    fontFamily: displayFontFamily,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  currentDbText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  targetBadge: {
    alignItems: 'flex-end',
  },
  targetLabel: {
    color: '#666666',
    fontSize: 11,
    fontFamily: displayFontFamily,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  targetDbText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 22,
    fontWeight: '800',
  },
  progressContainer: {
    gap: 6,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ececec',
    overflow: 'hidden',
    position: 'relative',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#555555',
    borderRadius: 5,
  },
  progressBarSuccess: {
    backgroundColor: '#000000',
  },
  targetMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#000000',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressSubtext: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  progressTargetSubtext: {
    color: '#888888',
    fontSize: 12,
  },
  waveformContainer: {
    height: 64,
    backgroundColor: '#fafafa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  waveformBarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: '100%',
    width: '100%',
  },
  waveformBar: {
    width: 5,
    borderRadius: 2.5,
  },
  waveformBarIdle: {
    backgroundColor: '#cccccc',
  },
  waveformBarMedium: {
    backgroundColor: '#888888',
  },
  waveformBarActive: {
    backgroundColor: '#000000',
  },
  waveformTargetLine: {
    position: 'absolute',
    top: 14,
    left: 10,
    right: 10,
    height: 1,
    borderBottomWidth: 1,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
  },
  statusBox: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  coachingText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 19,
  },
  successMessageGroup: {
    alignItems: 'center',
    gap: 3,
  },
  successTitle: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  successSubtitle: {
    color: '#555555',
    fontFamily: displayFontFamily,
    fontSize: 13,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dapButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#000000',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dapButtonPressed: {
    backgroundColor: '#333333',
  },
  dapButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  micButton: {
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#ececec',
    backgroundColor: '#fafafa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonText: {
    color: '#000000',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  micListeningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#ececec',
  },
  micPulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  micListeningText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
  },
  successActions: {
    width: '100%',
    gap: 8,
  },
  rateDapButton: {
    width: '100%',
    height: 48,
    backgroundColor: '#000000',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateDapButtonText: {
    color: '#ffffff',
    fontFamily: displayFontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  dapAgainButton: {
    width: '100%',
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dapAgainText: {
    color: '#666666',
    fontFamily: displayFontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
});
