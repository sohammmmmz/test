"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { shortDate } from "@/lib/format";
import type { ProjectDocument } from "@/lib/types";

const SLOTS = [
  { kind: "brd" as const, label: "Business requirements" },
  { kind: "technical" as const, label: "Technical document" },
];

/**
 * The two documents a project is expected to carry.
 *
 * Uploading commits the file to the documentation branch — it lives in git, not
 * in a database column, so it is versioned with the project and readable by
 * anyone who clones it.
 */
export function Documents({ projectId, documents, canEdit, branch }: {
  projectId: number;
  documents: ProjectDocument[];
  canEdit: boolean;
  branch: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function upload(kind: string, file: File) {
    setBusy(kind);
    setFailure(null);
    const body = new FormData();
    body.append("kind", kind);
    body.append("file", file);

    const res = await fetch(`/api/proxy/api/projects/${projectId}/documents/`, {
      method: "POST", body,
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFailure(data.detail ?? "The file could not be committed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="panel rise" style={{ overflow: "hidden", animationDelay: "60ms" }}>
      <div className="panel-head">
        <h2 style={{ fontSize: "1.02rem" }}>Documents</h2>
        <span className="mono eyebrow">{branch} branch</span>
      </div>

      {failure && (
        <p style={{ padding: "10px 18px", fontSize: ".81rem", color: "var(--overdue)",
                    background: "var(--overdue-wash)" }}>
          {failure}
        </p>
      )}

      <div className="stack">
        {SLOTS.map((slot) => {
          const doc = documents.find((d) => d.kind === slot.kind);
          const uploading = busy === slot.kind;
          return (
            <div key={slot.kind} className="row gap-3 center"
                 style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)" }}>
              <span className="dot" style={{ background: doc ? "var(--done)" : "var(--line-firm)" }} />
              <span className="stack grow">
                <span style={{ fontSize: ".87rem", fontWeight: 500 }}>{slot.label}</span>
                <span className="mono faint" style={{ fontSize: ".72rem" }}>
                  {doc ? `${doc.repo_path} · ${shortDate(doc.uploaded_at)}` : "not uploaded"}
                </span>
              </span>
              {canEdit && (
                <label className="btn btn-sm" style={{ cursor: uploading ? "progress" : "pointer" }}>
                  {uploading && <span className="spin" />}
                  {uploading ? "Committing" : doc ? "Replace" : "Upload"}
                  <input
                    type="file" hidden disabled={uploading}
                    accept=".pdf,.docx,.doc,.md,.txt"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload(slot.kind, file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      <p className="faint" style={{ padding: "12px 18px", fontSize: ".75rem" }}>
        PDF, Word or Markdown, up to 20 MB. Each file is committed to the{" "}
        <code className="mono">{branch}</code> branch under <code className="mono">docs/</code>.
      </p>
    </div>
  );
}
