/** Health — live telemetry over /ws/telemetry, tiles you can pick up. */

import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Backdrop } from "@/components/Backdrop";
import { Sloth } from "@/components/Sloth";
import { SlothLoader } from "@/components/SlothLoader";
import { Sparkline } from "@/components/Sparkline";
import { TiltCard } from "@/components/TiltCard";
import {
  apiFetch,
  wsUrl,
  type DeviceInfo,
  type ProcessInfo,
  type TelemetrySnapshot,
} from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { canopy, glassCard } from "@/lib/theme";

const HISTORY = 60;

function maxTemp(s: TelemetrySnapshot): number | null {
  const v = Object.values(s.temps);
  return v.length ? Math.max(...v) : null;
}

export default function HealthScreen() {
  const settings = useSettings();
  const [history, setHistory] = useState<TelemetrySnapshot[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [live, setLive] = useState(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch<DeviceInfo>(settings, "/api/health/device").then(setDevice).catch(() => {});
    let closed = false;
    let ws: WebSocket;
    function connect() {
      ws = new WebSocket(wsUrl(settings, "/ws/telemetry"));
      ws.onopen = () => setLive(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "telemetry") {
          setHistory((prev) => [...prev.slice(-(HISTORY - 1)), msg.snapshot]);
          setProcesses(msg.processes);
        }
      };
      ws.onclose = () => {
        setLive(false);
        if (!closed) retry.current = setTimeout(connect, 3000);
      };
    }
    connect();
    return () => {
      closed = true;
      if (retry.current) clearTimeout(retry.current);
      ws.close();
    };
  }, [settings]);

  const latest = history[history.length - 1];
  const temp = latest ? maxTemp(latest) : null;
  const disk = latest?.disk.find((d) => d.mount === "/") ?? latest?.disk[0];

  const tiles = latest
    ? [
        {
          label: "CPU",
          value: `${latest.cpu_percent.toFixed(0)}%`,
          sub: `load ${latest.load_avg[0].toFixed(2)}`,
          color: canopy.seriesCpu,
          points: history.map((s) => s.cpu_percent),
        },
        {
          label: "Memory",
          value: `${latest.mem_used_gb.toFixed(1)} GB`,
          sub: `${latest.mem_percent.toFixed(0)}% of ${latest.mem_total_gb.toFixed(0)} GB`,
          color: canopy.seriesMem,
          points: history.map((s) => s.mem_percent),
        },
        {
          label: "Temperature",
          value: temp !== null ? `${temp.toFixed(0)}°C` : "—",
          sub: temp !== null ? "hottest sensor" : "no sensors",
          color: canopy.seriesTemp,
          points: history.map((s) => maxTemp(s) ?? 0),
        },
        {
          label: "GPU",
          value:
            latest.gpu?.gpu_percent != null ? `${latest.gpu.gpu_percent.toFixed(0)}%` : "—",
          sub: latest.gpu ? "tegra" : "not a Jetson",
          color: canopy.seriesGpu,
          points: history.map((s) => s.gpu?.gpu_percent ?? 0),
        },
      ]
    : [];

  return (
    <View style={styles.root}>
      <Backdrop />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Sloth state={live ? "idle" : "thinking"} />
          <Pressable onPress={() => router.push("/settings")} hitSlop={12}>
            <Text style={styles.gear}>⚙</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>{device?.hostname ?? "the Jetson"}</Text>
          <Text style={styles.subtitle}>
            {device
              ? `${device.model} · up ${Math.floor(device.uptime_s / 3600)}h`
              : live
                ? "reading device info…"
                : `can't reach ${settings.apiUrl} — check settings ⚙`}
          </Text>

          {!latest && (
            <SlothLoader
              label={live ? "listening for the first telemetry tick…" : undefined}
            />
          )}

          <View style={styles.grid}>
            {tiles.map((tile, i) => (
              <Animated.View
                key={tile.label}
                entering={FadeInDown.delay(i * 90).springify()}
                style={styles.cell}
              >
                <TiltCard style={[glassCard, styles.tile]}>
                  <Text style={styles.tileLabel}>{tile.label.toUpperCase()}</Text>
                  <Text style={styles.tileValue}>{tile.value}</Text>
                  <Text style={styles.tileSub}>{tile.sub}</Text>
                  <Sparkline points={tile.points} color={tile.color} />
                </TiltCard>
              </Animated.View>
            ))}
          </View>

          {disk && (
            <Animated.View entering={FadeInDown.delay(380).springify()}>
              <TiltCard max={4} style={[glassCard, styles.tile]}>
                <Text style={styles.tileLabel}>STORAGE</Text>
                <Text style={styles.tileValue}>{disk.percent.toFixed(0)}%</Text>
                <Text style={styles.tileSub}>
                  {disk.used_gb.toFixed(0)} / {disk.total_gb.toFixed(0)} GB on {disk.mount}
                </Text>
                <View style={styles.meter}>
                  <View
                    style={[
                      styles.meterFill,
                      {
                        width: `${disk.percent}%`,
                        backgroundColor:
                          disk.percent > 90 ? canopy.statusCritical : canopy.seriesCpu,
                      },
                    ]}
                  />
                </View>
              </TiltCard>
            </Animated.View>
          )}

          {processes.length > 0 && (
            <View style={[glassCard, styles.procs]}>
              <Text style={styles.tileLabel}>PROCESSES</Text>
              {processes.slice(0, 8).map((p) => (
                <View key={p.pid} style={styles.procRow}>
                  <Text style={styles.procName} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.procStat}>{p.cpu_percent.toFixed(1)}%</Text>
                  <Text style={styles.procStat}>{p.mem_mb.toFixed(0)} MB</Text>
                </View>
              ))}
            </View>
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    borderBottomWidth: 3,
    borderBottomColor: canopy.canopy700,
    paddingBottom: 6,
  },
  gear: { fontSize: 20, color: canopy.cream500, marginTop: 10 },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontFamily: "serif", fontStyle: "italic", fontSize: 24, color: canopy.cream100 },
  subtitle: { fontSize: 12, color: canopy.cream500, marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cell: { flexBasis: "47%", flexGrow: 1 },
  tile: { padding: 14, gap: 2 },
  tileLabel: { fontSize: 10, letterSpacing: 2, color: canopy.cream500 },
  tileValue: { fontSize: 28, fontWeight: "600", color: canopy.cream100 },
  tileSub: { fontSize: 11, color: canopy.cream500, marginBottom: 6 },
  meter: { height: 6, borderRadius: 3, backgroundColor: canopy.canopy800, overflow: "hidden", marginTop: 8 },
  meterFill: { height: "100%", borderRadius: 3 },
  procs: { padding: 14, gap: 8 },
  procRow: { flexDirection: "row", gap: 12 },
  procName: { flex: 1, color: canopy.cream300, fontSize: 12, fontFamily: "monospace" },
  procStat: { width: 64, textAlign: "right", color: canopy.cream500, fontSize: 12, fontFamily: "monospace" },
});
