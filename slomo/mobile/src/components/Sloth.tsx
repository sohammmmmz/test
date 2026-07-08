/** The mascot, hanging from the top edge — slow sway, faster when busy. */

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { canopy } from "@/lib/theme";

export type SlothState = "idle" | "listening" | "thinking" | "speaking" | "working";

const LABEL: Record<SlothState, string> = {
  idle: "hanging around",
  listening: "listening…",
  thinking: "thinking (slowly)…",
  speaking: "speaking",
  working: "working on it…",
};

const PERIOD: Record<SlothState, number> = {
  idle: 3500,
  listening: 1300,
  thinking: 900,
  speaking: 500,
  working: 600,
};

export function Sloth({ state = "idle", size = 34 }: { state?: SlothState; size?: number }) {
  const angle = useSharedValue(-4);

  useEffect(() => {
    const ms = PERIOD[state];
    angle.value = withRepeat(
      withSequence(
        withTiming(4, { duration: ms, easing: Easing.inOut(Easing.quad) }),
        withTiming(-4, { duration: ms, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [state, angle]);

  const swing = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}deg` }, { rotateZ: "180deg" }],
  }));

  return (
    <View style={styles.row} accessibilityLabel={`SloMo is ${LABEL[state]}`}>
      <View style={styles.hang}>
        <View style={styles.claws}>
          <View style={styles.claw} />
          <View style={styles.claw} />
        </View>
        <Animated.Text style={[{ fontSize: size, lineHeight: size + 4 }, swing]}>🦥</Animated.Text>
      </View>
      <Text style={styles.label}>{LABEL[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  hang: { alignItems: "center" },
  claws: { flexDirection: "row", gap: 10, marginBottom: -3 },
  claw: { width: 3, height: 7, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: canopy.cream700 },
  label: { marginTop: 12, fontStyle: "italic", fontSize: 13, color: canopy.cream500 },
});
