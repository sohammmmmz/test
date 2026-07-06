"""Hybrid memory recall (Kùzu graph + Chroma vectors) before planning."""

from app.agent.state import SloMoState
from app.services.memory import memory_service


def memory_recall(state: SloMoState) -> dict:
    hits = memory_service.search(state["user_input"], k=5)
    recalled = [h.model_dump(mode="json") for h in hits]
    # If a single project dominates recall, treat it as the active project.
    project_ids = [h.node_id for h in hits if h.kind == "Project"]
    active = state.get("active_project") or (project_ids[0] if project_ids else None)
    return {"recalled_context": recalled, "active_project": active}
