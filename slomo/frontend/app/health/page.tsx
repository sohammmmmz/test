"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, wsUrl, type ProcessInfo, type TelemetrySnapshot } from "@/lib/api";
import { HealthCards } from "@/components/HealthCards";
import { ProcessTable } from "@/components/ProcessTable";

const HISTORY_LEN = 90; // ~3 minutes at a 2 s tick

interface DeviceInfo {
  hostname: string;
  model: string;
  os: string;
  jetpack: string | null;
  cuda: string | null;
  ram_gb: number;
  ip: string | null;
  uptime_s: number;
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export default function HealthPage() {
  const [history, setHistory] = useState<TelemetrySnapshot[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [wsState, setWsState] = useState<"connecting" | "live" | "down">("connecting");
  const retryRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { data: device } = useQuery({
    queryKey: ["device"],
    queryFn: () => apiFetch<DeviceInfo>("/api/health/device"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    let closed = false;
    function connect() {
      const ws = new WebSocket(wsUrl("/ws/telemetry"));
      ws.onopen = () => setWsState("live");
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "telemetry") {
          setHistory((prev) => [...prev.slice(-(HISTORY_LEN - 1)), msg.snapshot]);
          setProcesses(msg.processes);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setWsState("down");
        retryRef.current = setTimeout(connect, 3000);
      };
      return ws;
    }
    const ws = connect();
    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      ws.close();
    };
  }, []);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="font-display text-2xl text-cream-100">
          {device?.hostname ?? "the Jetson"}
        </h1>
        <p className="text-sm text-cream-500">
          {device
            ? `${device.model} · ${device.os}${device.jetpack ? ` · ${device.jetpack}` : ""}${device.cuda ? ` · CUDA ${device.cuda}` : ""} · up ${formatUptime(device.uptime_s)}`
            : "reaching the device…"}
        </p>
        <span
          className="ml-auto text-xs flex items-center gap-1.5"
          style={{ color: wsState === "live" ? "var(--status-good)" : "var(--status-serious)" }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: "currentColor" }} />
          {wsState === "live" ? "telemetry live" : wsState === "down" ? "reconnecting…" : "connecting…"}
        </span>
      </section>

      {history.length ? (
        <HealthCards history={history} />
      ) : (
        <div className="rounded-xl border border-dashed border-canopy-700 p-10 text-center text-cream-500 text-sm">
          Waiting for the first telemetry tick… SloMo moves slowly, the data shouldn&apos;t.
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-cream-500">
          Processes (claude · python · node)
        </h2>
        <ProcessTable processes={processes} />
      </section>
    </div>
  );
}
