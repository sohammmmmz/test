"use client";

import type { TelemetrySnapshot } from "@/lib/api";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  history: TelemetrySnapshot[];
}

function maxTemp(snap: TelemetrySnapshot): number | null {
  const values = Object.values(snap.temps);
  return values.length ? Math.max(...values) : null;
}

interface TileSpec {
  label: string;
  value: string;
  sub: string;
  series: string; // CSS var — fixed per entity, never cycled
  points: { t: number; v: number }[];
  status?: { tone: "warning" | "critical"; note: string };
}

function Sparkline({ points, color }: { points: { t: number; v: number }[]; color: string }) {
  return (
    <div className="h-12 mt-2 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={`fill-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(${color})`} stopOpacity={0.25} />
              <stop offset="100%" stopColor={`var(${color})`} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: "var(--axis-baseline)", strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded border border-canopy-700 bg-canopy-900 px-2 py-1 text-xs text-cream-300 font-mono">
                  {Number(payload[0].value).toFixed(1)}
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={`var(${color})`}
            strokeWidth={2}
            fill={`url(#fill-${color})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HealthCards({ history }: Props) {
  const latest = history[history.length - 1];
  if (!latest) return null;

  const toPoints = (pick: (s: TelemetrySnapshot) => number | null) =>
    history
      .map((s) => ({ t: s.ts, v: pick(s) }))
      .filter((p): p is { t: number; v: number } => p.v !== null);

  const temp = maxTemp(latest);
  const rootDisk = latest.disk.find((d) => d.mount === "/") ?? latest.disk[0];

  const tiles: TileSpec[] = [
    {
      label: "CPU",
      value: `${latest.cpu_percent.toFixed(0)}%`,
      sub: `load ${latest.load_avg[0].toFixed(2)} · ${latest.per_cpu.length} cores`,
      series: "--series-1",
      points: toPoints((s) => s.cpu_percent),
      status: latest.cpu_percent > 90 ? { tone: "critical", note: "saturated" } : undefined,
    },
    {
      label: "Memory",
      value: `${latest.mem_used_gb.toFixed(1)} GB`,
      sub: `${latest.mem_percent.toFixed(0)}% of ${latest.mem_total_gb.toFixed(0)} GB · swap ${latest.swap_percent.toFixed(0)}%`,
      series: "--series-2",
      points: toPoints((s) => s.mem_percent),
      status: latest.mem_percent > 90 ? { tone: "critical", note: "near limit" } : undefined,
    },
    {
      label: "Temperature",
      value: temp !== null ? `${temp.toFixed(0)}°C` : "—",
      sub: temp !== null ? "hottest sensor" : "no sensors visible",
      series: "--series-3",
      points: toPoints(maxTemp),
      status:
        temp !== null && temp > 85
          ? { tone: "critical", note: "throttling risk" }
          : temp !== null && temp > 70
            ? { tone: "warning", note: "running warm" }
            : undefined,
    },
  ];

  if (latest.gpu?.gpu_percent !== undefined && latest.gpu?.gpu_percent !== null) {
    tiles.push({
      label: "GPU",
      value: `${latest.gpu.gpu_percent.toFixed(0)}%`,
      sub: latest.gpu.nvp_model ?? "tegra",
      series: "--series-4",
      points: toPoints((s) => s.gpu?.gpu_percent ?? null),
    });
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-canopy-700 bg-canopy-900 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-widest text-cream-500">{tile.label}</span>
              {tile.status && (
                <span
                  className="text-xs font-medium"
                  style={{ color: `var(--status-${tile.status.tone})` }}
                >
                  {tile.status.tone === "critical" ? "▲" : "●"} {tile.status.note}
                </span>
              )}
            </div>
            <div className="mt-1 text-3xl font-sans font-semibold text-cream-100">{tile.value}</div>
            <div className="text-xs text-cream-500 mt-0.5">{tile.sub}</div>
            <Sparkline points={tile.points} color={tile.series} />
          </div>
        ))}
        {rootDisk && (
          <div className="rounded-xl border border-canopy-700 bg-canopy-900 p-4">
            <span className="text-xs uppercase tracking-widest text-cream-500">Storage</span>
            <div className="mt-1 text-3xl font-sans font-semibold text-cream-100">
              {rootDisk.percent.toFixed(0)}%
            </div>
            <div className="text-xs text-cream-500 mt-0.5">
              {rootDisk.used_gb.toFixed(0)} / {rootDisk.total_gb.toFixed(0)} GB on {rootDisk.mount}
            </div>
            <div className="mt-4 h-2 rounded-full bg-canopy-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-sloth"
                style={{
                  width: `${rootDisk.percent}%`,
                  background:
                    rootDisk.percent > 90 ? "var(--status-critical)" : "var(--series-1)",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
