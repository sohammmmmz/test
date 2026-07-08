import type { Settings } from "./settings";

export async function apiFetch<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${s.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.token}`,
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function wsUrl(s: Settings, path: string): string {
  const base = s.apiUrl.replace(/^http/, "ws");
  return `${base}${path}?token=${encodeURIComponent(s.token)}`;
}

export interface Project {
  id: string;
  name: string;
  stack: string;
  description: string;
}

export interface SessionInfo {
  id: string;
  project_id: string;
  pid: number | null;
  status: "running" | "exited" | "killed";
  unread_bytes: number;
}

export interface TelemetrySnapshot {
  ts: number;
  cpu_percent: number;
  mem_percent: number;
  mem_used_gb: number;
  mem_total_gb: number;
  swap_percent: number;
  disk: { mount: string; total_gb: number; used_gb: number; percent: number }[];
  temps: Record<string, number>;
  load_avg: [number, number, number];
  gpu: { gpu_percent?: number } | null;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
}

export interface DeviceInfo {
  hostname: string;
  model: string;
  os: string;
  jetpack: string | null;
  uptime_s: number;
}
