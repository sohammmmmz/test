/** One Claude Code PTY, full screen — slides up as a modal sheet. */

import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { wsUrl } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { canopy } from "@/lib/theme";

const CURSOR_FWD = /\x1b\[(\d+)C/g; // cursor-forward carries layout: keep it as spaces
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[=>78]/g;

function toPlainText(data: string): string {
  return data
    .replace(CURSOR_FWD, (_m, n) => " ".repeat(Math.min(Number(n), 200)))
    .replace(ANSI_RE, "");
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const settings = useSettings();
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl(settings, `/ws/sessions/${id}`));
    wsRef.current = ws;
    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "output") {
        setOutput((prev) => (prev + toPlainText(msg.data)).slice(-40_000));
      }
    };
    return () => ws.close();
  }, [id, settings]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [output]);

  const send = () => {
    if (!input.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "input", data: input + "\r" }));
    setInput("");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View
          style={[
            styles.dot,
            { backgroundColor: status === "open" ? canopy.statusGood : canopy.statusSerious },
          ]}
        />
        <Text style={styles.title}>claude · {id}</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.termPad}>
          <Text style={styles.term}>
            {output || (status === "connecting" ? "connecting to the canopy…" : "no output yet")}
          </Text>
        </ScrollView>
        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            placeholder="Talk to this Claude directly…"
            placeholderTextColor={canopy.cream700}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
          />
          <Pressable style={styles.btn} onPress={send}>
            <Text style={styles.btnText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canopy.bark900 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: canopy.canopy700,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1, color: canopy.cream300, fontFamily: "monospace", fontSize: 13 },
  close: { color: canopy.cream500, fontSize: 16 },
  termPad: { padding: 14 },
  term: { color: canopy.cream300, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: canopy.canopy700 },
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: canopy.canopy700,
    backgroundColor: canopy.canopy900,
    color: canopy.cream100,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: "monospace",
    fontSize: 13,
  },
  btn: {
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,189,140,0.4)",
    backgroundColor: "rgba(138,168,111,0.2)",
  },
  btnText: { color: canopy.moss300, fontSize: 13 },
});
