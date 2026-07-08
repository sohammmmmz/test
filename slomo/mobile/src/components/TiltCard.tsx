/**
 * Leaf physics for touch: press and drag anywhere on the card and it tilts
 * toward your finger in 3D, springing flat on release. A soft haptic tick
 * marks the pickup.
 */

import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Platform, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const SPRING = { damping: 16, stiffness: 180, mass: 0.7 };

function tick() {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export function TiltCard({
  children,
  style,
  max = 8,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  max?: number;
  onPress?: () => void;
}) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const px = useSharedValue(0.5);
  const py = useSharedValue(0.5);
  const held = useSharedValue(0);

  const pan = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .onBegin((e) => {
      px.value = Math.min(1, Math.max(0, e.x / size.w));
      py.value = Math.min(1, Math.max(0, e.y / size.h));
      held.value = withSpring(1, SPRING);
      runOnJS(tick)();
    })
    .onUpdate((e) => {
      px.value = Math.min(1, Math.max(0, e.x / size.w));
      py.value = Math.min(1, Math.max(0, e.y / size.h));
    })
    .onFinalize(() => {
      held.value = withSpring(0, SPRING);
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((_e, success) => {
      if (success && onPress) runOnJS(onPress)();
    });

  const gesture = Gesture.Simultaneous(pan, tap);

  const animatedStyle = useAnimatedStyle(() => {
    const rx = interpolate(py.value, [0, 1], [max, -max]) * held.value;
    const ry = interpolate(px.value, [0, 1], [-max, max]) * held.value;
    return {
      transform: [
        { perspective: 700 },
        { rotateX: withSpring(`${rx}deg`, SPRING) },
        { rotateY: withSpring(`${ry}deg`, SPRING) },
        { scale: withSpring(1 + held.value * 0.02, SPRING) },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) =>
          setSize({ w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 })
        }
        style={[style, animatedStyle]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
