export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const AUTH_TOKEN = process.env.NEXT_PUBLIC_SLOMO_TOKEN ?? "change-me";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Browsers can't set WS headers, so auth rides a query param. */
export function wsUrl(path: string): string {
  const url = new URL(API_URL);
  const proto = url.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${url.host}${path}?token=${encodeURIComponent(AUTH_TOKEN)}`;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  stack: string;
  description: string;
  created_at: string;
  last_active: string | null;
  tags: string[];
}

export interface SessionInfo {
  id: string;
  project_id: string;
  pid: number | null;
  started_at: number;
  status: "running" | "exited" | "killed";
  unread_bytes: number;
}

export interface TelemetrySnapshot {
  ts: number;
  cpu_percent: number;
  per_cpu: number[];
  mem_percent: number;
  mem_used_gb: number;
  mem_total_gb: number;
  swap_percent: number;
  disk: { mount: string; total_gb: number; used_gb: number; percent: number }[];
  temps: Record<string, number>;
  load_avg: [number, number, number];
  gpu: { gpu_percent?: number; power_mw?: number; nvp_model?: string } | null;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cmdline: string;
  cpu_percent: number;
  mem_mb: number;
  status: string;
}
