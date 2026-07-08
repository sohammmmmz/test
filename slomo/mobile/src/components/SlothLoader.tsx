/**
 * The signature loading state, mobile edition: the vine draws itself down,
 * leaves spring open along it, SloMo unrolls at the tip and sways while
 * slothy phrases cycle. Mirrors the web SlothLoader choreography.
 */

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { canopy } from "@/lib/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const PHRASES = [
  "unrolling from the branch…",
  "stretching one arm…",
  "moving (slowly)…",
  "no rush, almost there…",
];

const VINE = "M60 2 C48 30 76 46 60 72 C46 95 72 106 60 128";
const VINE_LEN = 150; // a touch over the true path length; draw completes early, which reads fine
const LEAF = "M0 0 Q7 -3 9 -11 Q1 -9 0 0";

// x, y in the 120×160 viewBox; rotation; mirrored?
const LEAVES = [
  [53, 26, -50, false],
  [69, 50, 40, true],
  [50, 84, -35, false],
  [69, 104, 50, true],
] as const;

function Leaf({ x, y, r, mirror, delay }: { x: number; y: number; r: number; mirror: boolean; delay: number }) {
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withDelay(delay, withSpring(1, { damping: 11, stiffness: 210 }));
  }, [scale, delay]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${r}deg` }, { scaleX: mirror ? -scale.value : scale.value }, { scaleY: scale.value }],
  }));
  return (
    <Animated.View style={[styles.leaf, { left: `${(x / 120) * 100}%`, top: `${(y / 160) * 100}%` }, style]}>
      <Svg width={16} height={16} viewBox="-1 -13 12 14">
        <Path d={LEAF} fill={canopy.moss400} />
      </Svg>
    </Animated.View>
  );
}

export function SlothLoader({ label, size = 150 }: { label?: string; size?: number }) {
  const progress = useSharedValue(0);
  const sway = useSharedValue(-5);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) });
    sway.value = withRepeat(
      withSequence(
        withTiming(5, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(-5, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [progress, sway]);

  useEffect(() => {
    if (label) return;
    const t = setInterval(() => setTick((n) => n + 1), 2400);
    return () => clearInterval(t);
  }, [label]);

  const vineProps = useAnimatedProps(() => ({
    strokeDashoffset: VINE_LEN * (1 - progress.value),
  }));

  const slothStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${180 + sway.value}deg` }],
  }));

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <View style={{ width: size * 0.75, height: size }}>
        <Svg width="100%" height="100%" viewBox="0 0 120 160">
          <AnimatedPath
            d={VINE}
            fill="none"
            stroke={canopy.moss500}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={`${VINE_LEN}`}
            animatedProps={vineProps}
          />
        </Svg>
        {LEAVES.map(([x, y, r, mirror], i) => (
          <Leaf key={i} x={x} y={y} r={r} mirror={mirror} delay={350 + i * 280} />
        ))}
        <Animated.View entering={FadeIn.delay(1150)} style={styles.slothWrap}>
          <Animated.Text style={[styles.sloth, slothStyle]}>🦥</Animated.Text>
        </Animated.View>
      </View>
      <Animated.Text key={label ?? tick % PHRASES.length} entering={FadeInUp.duration(600)} style={styles.phrase}>
        {label ?? PHRASES[tick % PHRASES.length]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 8, paddingVertical: 28 },
  leaf: { position: "absolute", width: 16, height: 16, marginLeft: -2, marginTop: -2 },
  slothWrap: { position: "absolute", left: "50%", top: "74%", marginLeft: -16 },
  sloth: { fontSize: 30, lineHeight: 34 },
  phrase: { fontFamily: "serif", fontStyle: "italic", fontSize: 13, color: canopy.cream500 },
});
