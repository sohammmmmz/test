"""Graph memory: Kùzu (source of truth) + Chroma (semantic recall).

Both stores are optional imports — on machines without them the service
degrades to a JSON-persisted in-memory graph and substring-scored search so
the rest of the stack keeps working.
"""

import json
import platform
import time
import uuid
from typing import Any

from app.models.schemas import MemoryHit
from app.settings import settings

try:
    import kuzu  # type: ignore

    HAS_KUZU = True
except ImportError:
    HAS_KUZU = False

try:
    import chromadb  # type: ignore

    HAS_CHROMA = True
except ImportError:
    HAS_CHROMA = False

NODE_TABLES: dict[str, str] = {
    "Device": "id STRING PRIMARY KEY, model STRING, jetpack STRING, cuda STRING, ram_gb INT64, storage_json STRING, ip STRING, updated_at TIMESTAMP",
    "Project": "id STRING PRIMARY KEY, name STRING, path STRING, stack STRING, description STRING, created_at TIMESTAMP, last_active TIMESTAMP",
    "Session": "id STRING PRIMARY KEY, pid INT64, started_at TIMESTAMP, status STRING, log_path STRING",
    "Conversation": "id STRING PRIMARY KEY, summary STRING, embedding_id STRING, ts TIMESTAMP",
    "Package": "id STRING PRIMARY KEY, name STRING, version STRING",
    "Insight": "id STRING PRIMARY KEY, text STRING, embedding_id STRING",
}

REL_TABLES: dict[str, tuple[str, str]] = {
    "RUNS_ON": ("Project", "Device"),
    "BELONGS_TO": ("Session", "Project"),
    "ABOUT": ("Conversation", "Project"),
    "USES": ("Project", "Package"),
    "APPLIES_TO": ("Insight", "Project"),
    "MENTIONS": ("Conversation", "Insight"),
}

# Which text field per node kind gets embedded for semantic recall
_EMBED_FIELDS = {"Project": "description", "Conversation": "summary", "Insight": "text"}


class MemoryService:
    def __init__(self) -> None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self._fallback_path = settings.data_dir / "memory-fallback.json"
        self._nodes: dict[str, dict] = {}
        self._edges: list[dict] = []
        self._conn = None
        self._collection = None

        if HAS_KUZU:
            db = kuzu.Database(str(settings.data_dir / "kuzu"))
            self._conn = kuzu.Connection(db)
            for table, ddl in NODE_TABLES.items():
                self._conn.execute(f"CREATE NODE TABLE IF NOT EXISTS {table}({ddl})")
            for rel, (src, dst) in REL_TABLES.items():
                self._conn.execute(f"CREATE REL TABLE IF NOT EXISTS {rel}(FROM {src} TO {dst})")
        elif self._fallback_path.exists():
            data = json.loads(self._fallback_path.read_text())
            self._nodes, self._edges = data.get("nodes", {}), data.get("edges", [])

        if HAS_CHROMA:
            client = chromadb.PersistentClient(path=str(settings.data_dir / "chroma"))
            self._collection = client.get_or_create_collection("slomo")

    # ---------- graph ----------

    def _persist_fallback(self) -> None:
        if self._conn is None:
            self._fallback_path.write_text(json.dumps({"nodes": self._nodes, "edges": self._edges}))

    def upsert_node(self, kind: str, props: dict[str, Any]) -> str:
        if kind not in NODE_TABLES:
            raise ValueError(f"unknown node kind: {kind}")
        node_id = props.get("id") or uuid.uuid4().hex[:12]
        props = {**props, "id": node_id}

        if self._conn is not None:
            self._conn.execute(f"MATCH (n:{kind} {{id: $id}}) DELETE n", {"id": node_id})
            cols = [c.split()[0] for c in NODE_TABLES[kind].split(",")]
            usable = {k: v for k, v in props.items() if k in cols}
            placeholders = ", ".join(f"{k}: ${k}" for k in usable)
            self._conn.execute(f"CREATE (n:{kind} {{{placeholders}}})", usable)
        else:
            self._nodes[node_id] = {"kind": kind, **props}
            self._persist_fallback()

        embed_field = _EMBED_FIELDS.get(kind)
        text = props.get(embed_field or "", "")
        if self._collection is not None and text:
            self._collection.upsert(
                ids=[node_id], documents=[text], metadatas=[{"kind": kind, "node_id": node_id}]
            )
        return node_id

    def link(self, a: str, rel: str, b: str) -> None:
        if rel not in REL_TABLES:
            raise ValueError(f"unknown relation: {rel}")
        if self._conn is not None:
            src, dst = REL_TABLES[rel]
            self._conn.execute(
                f"MATCH (a:{src} {{id: $a}}), (b:{dst} {{id: $b}}) CREATE (a)-[:{rel}]->(b)",
                {"a": a, "b": b},
            )
        else:
            self._edges.append({"from": a, "rel": rel, "to": b})
            self._persist_fallback()

    def node_with_neighbors(self, node_id: str) -> dict[str, Any]:
        if self._conn is not None:
            result = self._conn.execute(
                "MATCH (n {id: $id}) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m",
                {"id": node_id},
            )
            node, neighbors = None, []
            while result.has_next():
                n, r, m = result.get_next()
                node = node or n
                if m is not None:
                    neighbors.append({"rel": r["_label"] if r else None, "node": m})
            return {"node": node, "neighbors": neighbors}
        node = self._nodes.get(node_id)
        neighbors = [
            {"rel": e["rel"], "node": self._nodes.get(e["to"] if e["from"] == node_id else e["from"])}
            for e in self._edges
            if node_id in (e["from"], e["to"])
        ]
        return {"node": node, "neighbors": neighbors}

    # ---------- recall ----------

    def search(self, query: str, k: int = 5) -> list[MemoryHit]:
        if self._collection is not None and self._collection.count() > 0:
            res = self._collection.query(query_texts=[query], n_results=min(k, self._collection.count()))
            hits = []
            for node_id, doc, meta, dist in zip(
                res["ids"][0], res["documents"][0], res["metadatas"][0], res["distances"][0]
            ):
                hits.append(
                    MemoryHit(
                        node_id=node_id,
                        kind=str(meta.get("kind", "?")),
                        text=doc or "",
                        score=round(1 / (1 + dist), 3),
                        props=self.node_with_neighbors(node_id).get("node") or {},
                    )
                )
            return hits
        # naive substring fallback
        terms = [t for t in query.lower().split() if len(t) > 2]
        scored = []
        for node_id, node in self._nodes.items():
            text = " ".join(str(v) for v in node.values()).lower()
            score = sum(1 for t in terms if t in text)
            if score:
                scored.append(
                    MemoryHit(node_id=node_id, kind=node.get("kind", "?"), text=str(node)[:300],
                              score=score / max(len(terms), 1), props=node)
                )
        return sorted(scored, key=lambda h: h.score, reverse=True)[:k]

    # ---------- bootstrap ----------

    def bootstrap_device_node(self) -> str:
        from app.services import telemetry

        info = telemetry.device_info()
        return self.upsert_node(
            "Device",
            {
                "id": info.hostname,
                "model": info.model,
                "jetpack": info.jetpack or "",
                "cuda": info.cuda or "",
                "ram_gb": int(info.ram_gb),
                "storage_json": json.dumps(info.storage),
                "ip": info.ip or "",
            },
        )


memory_service = MemoryService()
