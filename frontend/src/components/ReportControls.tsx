"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Choosing the window, and getting the file.
 *
 * The period lives in the URL rather than in component state so the page is
 * rendered on the server for whichever window is chosen — the preview and the
 * spreadsheet then come from one call to one builder, and cannot disagree.
 *
 * The download is a real navigation to the export endpoint rather than a fetch
 * and a blob. The browser already knows how to save a file the server marks as
 * an attachment; rebuilding that in JavaScript buys nothing and breaks the
 * moment a popup blocker takes an interest.
 */
export function ReportControls({ period, anchor, filename }: {
  period: "daily" | "weekly";
  anchor: string;
  filename: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [downloading, setDownloading] = useState(false);

  function go(next: Record<string, string>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) query.set(key, value);
    router.push(`/reports?${query}`);
  }

  const href = `/api/proxy/api/reports/export?period=${period}&date=${anchor}`;

  return (
    <div className="row gap-3 wrap center">
      <div className="seg" role="group" aria-label="Report period">
        <button data-on={period === "daily"} onClick={() => go({ period: "daily" })}>
          Daily
        </button>
        <button data-on={period === "weekly"} onClick={() => go({ period: "weekly" })}>
          Weekly
        </button>
      </div>

      <input
        type="date"
        className="field"
        style={{ width: "auto" }}
        value={anchor}
        aria-label={period === "daily" ? "Which day" : "Any day in the week"}
        onChange={(e) => e.target.value && go({ date: e.target.value })}
      />

      <a
        className="btn btn-primary btn-lg"
        href={href}
        download={filename}
        onClick={() => {
          // Purely cosmetic: a navigation to a download leaves the page in
          // place, so nothing else would ever acknowledge the click.
          setDownloading(true);
          setTimeout(() => setDownloading(false), 2500);
        }}
      >
        {downloading ? <span className="spin" /> : <DownIcon />}
        {downloading ? "Building…" : "Download Excel"}
      </a>
    </div>
  );
}

function DownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16" />
    </svg>
  );
}
