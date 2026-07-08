/** The forest behind the glass, mobile edition: bark gradient + fireflies. */

import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { canopy } from "@/lib/theme";

const FLIES = [
  [12, 18, 16000, 0],
  [78, 12, 21000, 2500],
  [30, 46, 18000, 6000],
  [88, 58, 23000, 1000],
  [55, 30, 17000, 4200],
  [18, 74, 24000, 8000],
  [68, 82, 19000, 3000],
] as const;

function Firefly({ left, top, dur, delay }: { left: number; top: number; dur: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: dur, easing: Easing.linear }), -1));
  }, [t, dur, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.85 * Math.sin(Math.PI * t.value),
    transform: [{ translateX: t.value * 36 }, { translateY: t.value * -60 }],
  }));
  return <Animated.View style={[styles.fly, { left: `${left}%`, top: `${top}%` }, style]} />;
}

export function Backdrop() {
  return (
    <LinearGradient
      colors={["#151a11", canopy.bark950, "#0e120c"]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {FLIES.map(([left, top, dur, delay], i) => (
        <Firefly key={i} left={left} top={top} dur={dur} delay={delay} />
      ))}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fly: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: canopy.amber400,
    shadowColor: canopy.amber400,
    shadowOpacity: 0.6,
    shadowRadius: 5,
  },
});
