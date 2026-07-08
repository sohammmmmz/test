/** Workspace — projects and their Claude sessions; tap a card to open its
 * terminal, long-hold physics on every card. */

import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Backdrop } from "@/components/Backdrop";
import { Sloth } from "@/components/Sloth";
import { TiltCard } from "@/components/TiltCard";
import { apiFetch, type Project, type SessionInfo } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { canopy, glassCard } from "@/lib/theme";

const STACK_ICON: Record<string, string> = {
  blank: "🌿",
  python: "🐍",
  node: "🟩",
  fastapi: "⚡",
  react: "⚛️",
};

export default function WorkspaceScreen() {
  const settings = useSettings();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        apiFetch<Project[]>(settings, "/api/projects"),
        apiFetch<SessionInfo[]>(settings, "/api/sessions"),
      ]);
      setProjects(p);
      setSessions(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [settings]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const resume = async (projectId: string) => {
    try {
      const session = await apiFetch<SessionInfo>(
        settings,
        `/api/projects/${projectId}/session`,
        { method: "POST" },
      );
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = (projectId: string) => {
    Alert.alert("Delete project", `Delete "${projectId}" and all its files?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await apiFetch<void>(settings, `/api/projects/${projectId}`, { method: "DELETE" });
          void load();
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <Backdrop />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Sloth />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={canopy.moss400}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          <Text style={styles.title}>Workspace</Text>
          {error && (
            <Text style={styles.error}>
              {error} — pull to retry, or check settings on the Health tab.
            </Text>
          )}
          {projects.length === 0 && !error && (
            <View style={[glassCard, styles.emptyCard]}>
              <Text style={{ fontSize: 30 }}>🦥</Text>
              <Text style={styles.emptyText}>
                The workspace is empty. Ask SloMo in the chat to create a project.
              </Text>
            </View>
          )}
          {projects.map((project, i) => {
            const live = sessions.find(
              (s) => s.project_id === project.id && s.status === "running",
            );
            return (
              <Animated.View key={project.id} entering={FadeInDown.delay(i * 80).springify()}>
                <TiltCard
                  max={5}
                  style={[glassCard, styles.card]}
                  onPress={() => void resume(project.id)}
                >
                  <Text style={styles.cardIcon}>{STACK_ICON[project.stack] ?? "🌿"}</Text>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardName}>{project.name}</Text>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {project.stack}
                      {project.description ? ` · ${project.description}` : ""}
                    </Text>
                    <Text style={live ? styles.liveText : styles.hintText}>
                      {live
                        ? `● claude live${live.unread_bytes > 0 ? " · unread output" : ""}`
                        : "tap to start its Claude session"}
                    </Text>
                  </View>
                  <Pressable hitSlop={10} onPress={() => remove(project.id)}>
                    <Text style={styles.deleteGlyph}>✕</Text>
                  </Pressable>
                </TiltCard>
              </Animated.View>
            );
          })}

          {sessions.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>CLAUDE SESSIONS</Text>
              {sessions.map((s) => (
                <Pressable
                  key={s.id}
                  style={[glassCard, styles.sessionRow]}
                  onPress={() => router.push(`/session/${s.id}`)}
                >
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          s.status === "running" ? canopy.statusGood : canopy.cream700,
                      },
                    ]}
                  />
                  <Text style={styles.sessionText}>
                    {s.project_id} · pid {s.pid ?? "—"} · {s.status}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
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
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontFamily: "serif", fontStyle: "italic", fontSize: 24, color: canopy.cream100 },
  error: { color: canopy.statusSerious, fontSize: 12 },
  emptyCard: { alignItems: "center", padding: 24, gap: 8 },
  emptyText: { color: canopy.cream500, fontSize: 13, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  cardIcon: { fontSize: 22 },
  cardBody: { flex: 1, gap: 2 },
  cardName: { color: canopy.cream100, fontSize: 16, fontWeight: "600" },
  cardSub: { color: canopy.cream500, fontSize: 12 },
  liveText: { color: canopy.moss300, fontSize: 11 },
  hintText: { color: canopy.cream700, fontSize: 11 },
  deleteGlyph: { color: canopy.cream700, fontSize: 16, padding: 4 },
  sectionLabel: { fontSize: 10, letterSpacing: 2, color: canopy.cream500, marginTop: 8 },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sessionText: { color: canopy.cream300, fontSize: 12, fontFamily: "monospace" },
});
