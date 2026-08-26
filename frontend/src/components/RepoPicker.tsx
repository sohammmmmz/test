"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AvailableRepo } from "@/lib/types";

/**
 * Choosing which repository backs a project.
 *
 * The list comes from the service token — the credential that will do the
 * writing — so anything offered here is guaranteed to work once linked. A
 * repository already backing another project is shown but not selectable:
 * hiding it would leave somebody hunting for a repo they can see in GitLab.
 */
export function RepoPicker({ value, onPick }: {
  value: AvailableRepo | null;
  onPick: (repo: AvailableRepo | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<AvailableRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    // Debounced: this runs on every keystroke and GitLab does the filtering.
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/proxy/api/projects/available-repos/?search=${encodeURIComponent(query)}`,
        );
        const data = await res.json();
        // Ignore a response overtaken by a newer keystroke.
        if (ticket !== latest.current) return;
        setRepos(data.repos ?? []);
        setDetail(data.detail ?? null);
      } catch {
        if (ticket === latest.current) setDetail("Could not reach GitLab.");
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <div className="row gap-3 center panel" style={{ padding: "10px 13px" }}>
        <span className="stack grow">
          <span style={{ fontSize: ".87rem", fontWeight: 500 }}>{value.name}</span>
          <span className="mono faint" style={{ fontSize: ".72rem" }}>
            {value.path_with_namespace} · default {value.default_branch ?? "—"}
          </span>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="stack gap-2">
      <input
        className="field"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your GitLab repositories"
      />
      {detail && (
        <p className="faint" style={{ fontSize: ".78rem" }}>{detail}</p>
      )}
      <div className="stack gap-1" style={{ maxHeight: 210, overflowY: "auto" }}>
        {loading && repos.length === 0 && (
          <p className="faint" style={{ fontSize: ".8rem", padding: "8px 2px" }}>
            Searching…
          </p>
        )}
        {!loading && repos.length === 0 && !detail && (
          <p className="faint" style={{ fontSize: ".8rem", padding: "8px 2px" }}>
            {query ? "Nothing matches that." : "No repositories available."}
          </p>
        )}
        {repos.map((repo) => {
          const taken = Boolean(repo.linked_to);
          return (
            <button
              key={repo.gitlab_project_id}
              type="button"
              disabled={taken}
              onClick={() => onPick(repo)}
              className="row gap-3 center"
              title={taken ? `Already backs "${repo.linked_to}"` : undefined}
              style={{
                textAlign: "left", padding: "8px 10px", borderRadius: 8,
                border: "1px solid var(--line)", background: "var(--surface)",
                cursor: taken ? "not-allowed" : "pointer", opacity: taken ? .5 : 1,
                font: "inherit", color: "inherit",
              }}
            >
              <span className="stack grow">
                <span style={{ fontSize: ".85rem", fontWeight: 500 }}>{repo.name}</span>
                <span className="mono faint" style={{ fontSize: ".71rem" }}>
                  {repo.path_with_namespace}
                </span>
              </span>
              {taken && <span className="pill">in use</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
