/** Chat with SloMo — same /ws/chat protocol as the web, including the
 * destructive-tool confirm cards. Voice stays on the web for now. */

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
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Backdrop } from "@/components/Backdrop";
import { Sloth, type SlothState } from "@/components/Sloth";
import { wsUrl } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { canopy, glassCard } from "@/lib/theme";

interface Bubble {
  id: number;
  role: "user" | "slomo" | "system";
  text: string;
}

interface Confirm {
  tool: string;
  args: Record<string, unknown>;
  message: string;
}

let nextId = 0;

export default function ChatScreen() {
  const settings = useSettings();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [slothState, setSlothState] = useState<SlothState>("idle");
  const [ready, setReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const add = (role: Bubble["role"], text: string) =>
    setBubbles((prev) => [...prev, { id: nextId++, role, text }]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl(settings, "/ws/chat"));
    wsRef.current = ws;
    ws.onopen = () => setReady(true);
    ws.onclose = () => setReady(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "state") setSlothState(msg.state === "idle" ? "idle" : msg.state);
      if (msg.type === "node" && msg.name === "tool_exec") setSlothState("working");
      if (msg.type === "confirm_request")
        setConfirm({ tool: msg.tool, args: msg.args, message: msg.message });
      if (msg.type === "reply") add("slomo", msg.text);
      if (msg.type === "error") add("system", msg.error);
    };
    return () => ws.close();
  }, [settings]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [bubbles, confirm]);

  const send = () => {
    const text = input.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    add("user", text);
    wsRef.current.send(JSON.stringify({ type: "user", text, channel: "text" }));
    setInput("");
  };

  const answer = (approved: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: "confirm", confirm: approved }));
    setConfirm(null);
  };

  return (
    <View style={styles.root}>
      <Backdrop />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Sloth state={slothState} />
        </View>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
            {bubbles.length === 0 && (
              <Animated.View entering={FadeInUp.springify()} style={styles.empty}>
                <Text style={styles.emptySloth}>🦥</Text>
                <Text style={styles.emptyQuote}>“No rush. What are we building today?”</Text>
                <Text style={styles.emptyHint}>
                  Ask about temps, projects, or say “resume the bird feeder cam”.
                </Text>
              </Animated.View>
            )}
            {bubbles.map((b) => (
              <Animated.View
                key={b.id}
                entering={FadeInDown.springify().damping(18)}
                style={[
                  styles.bubble,
                  b.role === "user" && styles.bubbleUser,
                  b.role === "slomo" && styles.bubbleSlomo,
                  b.role === "system" && styles.bubbleSystem,
                ]}
              >
                <Text style={b.role === "system" ? styles.systemText : styles.bubbleText}>
                  {b.role === "slomo" ? "🦥 " : ""}
                  {b.text}
                </Text>
              </Animated.View>
            ))}
            {confirm && (
              <Animated.View entering={FadeInDown.springify()} style={styles.confirm}>
                <Text style={styles.confirmText}>⚠ {confirm.message}</Text>
                <View style={styles.confirmRow}>
                  <Pressable style={styles.btnGhost} onPress={() => answer(false)}>
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.btnDanger} onPress={() => answer(true)}>
                    <Text style={styles.btnDangerText}>Yes, do it</Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              placeholder={ready ? "Ask SloMo anything…" : "connecting to SloMo…"}
              placeholderTextColor={canopy.cream700}
              editable={ready}
              style={styles.input}
              returnKeyType="send"
            />
            <Pressable style={[styles.btnSend, !ready && { opacity: 0.5 }]} onPress={send}>
              <Text style={styles.btnSendText}>Send</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canopy.bark950 },
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: 3,
    borderBottomColor: canopy.canopy700,
  },
  scroll: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { alignItems: "center", marginTop: 80, gap: 10, paddingHorizontal: 24 },
  emptySloth: { fontSize: 44 },
  emptyQuote: { fontFamily: "serif", fontStyle: "italic", fontSize: 16, color: canopy.cream300 },
  emptyHint: { fontSize: 12, color: canopy.cream500, textAlign: "center" },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(138,168,111,0.15)",
    borderWidth: 1,
    borderColor: "rgba(138,168,111,0.3)",
  },
  bubbleSlomo: { alignSelf: "flex-start", ...glassCard },
  bubbleSystem: {
    alignSelf: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: canopy.canopy700,
  },
  bubbleText: { color: canopy.cream100, fontSize: 14, lineHeight: 20 },
  systemText: { color: canopy.cream500, fontSize: 11 },
  confirm: {
    alignSelf: "center",
    borderWidth: 1,
    borderColor: canopy.statusWarning,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    maxWidth: "90%",
  },
  confirmText: { color: canopy.cream100, fontSize: 13 },
  confirmRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  btnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: canopy.canopy700,
  },
  btnGhostText: { color: canopy.cream300, fontSize: 13 },
  btnDanger: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: canopy.statusCritical,
    backgroundColor: "rgba(208,59,59,0.2)",
  },
  btnDangerText: { color: canopy.cream100, fontSize: 13 },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: canopy.canopy700 },
  input: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: canopy.canopy700,
    backgroundColor: canopy.canopy900,
    color: canopy.cream100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  btnSend: {
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,189,140,0.4)",
    backgroundColor: "rgba(138,168,111,0.2)",
  },
  btnSendText: { color: canopy.moss300, fontSize: 14 },
});
