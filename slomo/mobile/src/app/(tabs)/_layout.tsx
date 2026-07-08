import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { canopy } from "@/lib/theme";

function icon(glyph: string) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <Text style={{ fontSize: focused ? 22 : 18, color, opacity: focused ? 1 : 0.7 }}>
        {glyph}
      </Text>
    );
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        tabBarStyle: {
          backgroundColor: canopy.bark900,
          borderTopColor: canopy.canopy700,
          borderTopWidth: 2,
        },
        tabBarActiveTintColor: canopy.moss300,
        tabBarInactiveTintColor: canopy.cream500,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Health", tabBarIcon: icon("🌡") }} />
      <Tabs.Screen name="chat" options={{ title: "Chat", tabBarIcon: icon("🦥") }} />
      <Tabs.Screen name="workspace" options={{ title: "Workspace", tabBarIcon: icon("🌿") }} />
    </Tabs>
  );
}
