"use client";

import type { ProcessInfo } from "@/lib/api";

export function ProcessTable({ processes }: { processes: ProcessInfo[] }) {
  if (!processes.length) {
    return (
      <p className="text-sm text-cream-500">
        No claude / python / node processes right now. The canopy is quiet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-canopy-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-cream-500 border-b border-canopy-700">
            <th className="px-3 py-2 font-medium">PID</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Command</th>
            <th className="px-3 py-2 font-medium text-right">CPU %</th>
            <th className="px-3 py-2 font-medium text-right">Mem MB</th>
            <th className="px-3 py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody className="font-mono [font-variant-numeric:tabular-nums]">
          {processes.map((p) => (
            <tr key={p.pid} className="border-b border-canopy-800 last:border-0 hover:bg-canopy-800/50">
              <td className="px-3 py-1.5 text-cream-500">{p.pid}</td>
              <td className="px-3 py-1.5 text-cream-100">{p.name}</td>
              <td className="px-3 py-1.5 text-cream-500 max-w-[28rem] truncate">{p.cmdline}</td>
              <td className="px-3 py-1.5 text-right">{p.cpu_percent.toFixed(1)}</td>
              <td className="px-3 py-1.5 text-right">{p.mem_mb.toFixed(0)}</td>
              <td className="px-3 py-1.5 text-cream-500">{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
