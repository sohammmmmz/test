/** Where the Jetson lives — backend origin + access token. */

import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettings } from "@/lib/settings";
import { canopy } from "@/lib/theme";

export default function SettingsScreen() {
  const settings = useSettings();
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [token, setToken] = useState(settings.token);

  const save = async () => {
    await settings.save({ apiUrl: apiUrl.replace(/\/$/, ""), token });
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.body}>
        <Text style={styles.title}>Where the Jetson lives</Text>
        <Text style={styles.label}>Backend URL</Text>
        <TextInput
          value={apiUrl}
          onChangeText={setApiUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://slomo.local:8000"
          placeholderTextColor={canopy.cream700}
          style={styles.input}
        />
        <Text style={styles.label}>Access token</Text>
        <TextInput
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="the SLOMO_AUTH_TOKEN from the backend"
          placeholderTextColor={canopy.cream700}
          style={styles.input}
        />
        <Text style={styles.hint}>
          Both live in backend/.env on the Jetson. On the same Wi-Fi, the device IP
          (http://192.168.x.x:8000) also works.
        </Text>
        <View style={styles.row}>
          <Pressable style={styles.btnGhost} onPress={() => router.back()}>
            <Text style={styles.btnGhostText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.btnSave} onPress={save}>
            <Text style={styles.btnSaveText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canopy.bark900 },
  body: { padding: 20, gap: 10 },
  title: {
    fontFamily: "serif",
    fontStyle: "italic",
    fontSize: 22,
    color: canopy.cream100,
    marginBottom: 8,
  },
  label: { fontSize: 11, letterSpacing: 1.5, color: canopy.cream500, marginTop: 8 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: canopy.canopy700,
    backgroundColor: canopy.canopy900,
    color: canopy.cream100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  hint: { fontSize: 12, color: canopy.cream500, lineHeight: 17, marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  btnGhost: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: canopy.canopy700,
  },
  btnGhostText: { color: canopy.cream300, fontSize: 14 },
  btnSave: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,189,140,0.4)",
    backgroundColor: "rgba(138,168,111,0.25)",
  },
  btnSaveText: { color: canopy.moss300, fontSize: 14, fontWeight: "600" },
});
