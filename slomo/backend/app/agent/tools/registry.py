"""Tool registry exposed to the SloMo planner.

Names mirror the BRD: workspace.*, session.*, telemetry.*, memory.*
Each entry: fn (sync callable), description (shown to the planner LLM),
destructive (requires human confirmation via LangGraph interrupt).
"""

from dataclasses import dataclass
from typing import Any, Callable

from app.models.schemas import ProjectCreate
from app.services import telemetry, workspace
from app.services.memory import memory_service
from app.services.session_manager import session_manager


@dataclass(frozen=True)
class ToolSpec:
    fn: Callable[..., Any]
    description: str
    destructive: bool = False


def _create_project(name: str, template: str = "blank", description: str = "") -> dict:
    project = workspace.create_project(ProjectCreate(name=name, template=template, description=description))  # type: ignore[arg-type]
    memory_service.upsert_node(
        "Project",
        {"id": project.id, "name": project.name, "path": project.path,
         "stack": project.stack, "description": project.description},
    )
    return project.model_dump(mode="json")


def _session_start(project_id: str) -> dict:
    project = workspace.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"no such project: {project_id}")
    session = session_manager.start(project.id, project.path)
    memory_service.upsert_node(
        "Session",
        {"id": session.id, "pid": session.pid or 0, "status": session.status,
         "log_path": str(session.log_path)},
    )
    memory_service.link(session.id, "BELONGS_TO", project.id)
    return session.info().model_dump(mode="json")


TOOLS: dict[str, ToolSpec] = {
    "workspace.list_projects": ToolSpec(
        lambda: [p.model_dump(mode="json") for p in workspace.list_projects()],
        "List all projects in the workspace with metadata.",
    ),
    "workspace.create_project": ToolSpec(
        _create_project,
        "Create a project. args: name (str), template (blank|python|node|fastapi|react), description (str).",
    ),
    "workspace.delete_project": ToolSpec(
        lambda project_id: workspace.delete_project(project_id) or {"deleted": project_id},
        "Delete a project directory permanently. args: project_id.",
        destructive=True,
    ),
    "workspace.read_file": ToolSpec(
        workspace.read_file,
        "Read a file from a project. args: project_id, rel_path.",
    ),
    "session.start": ToolSpec(
        _session_start,
        "Start (or return the existing) Claude Code session for a project. args: project_id.",
    ),
    "session.send": ToolSpec(
        lambda session_id, text: session_manager.send(session_id, text + "\r") or {"sent": True},
        "Send a line of text to a running Claude session. args: session_id, text.",
    ),
    "session.kill": ToolSpec(
        lambda session_id: session_manager.kill(session_id) or {"killed": session_id},
        "Terminate a Claude session. args: session_id.",
        destructive=True,
    ),
    "session.status_all": ToolSpec(
        lambda: [s.model_dump(mode="json") for s in session_manager.status_all()],
        "List all Claude sessions and their status.",
    ),
    "telemetry.snapshot": ToolSpec(
        lambda: telemetry.snapshot().model_dump(mode="json"),
        "Current CPU/GPU/RAM/disk/temperature snapshot of the Jetson.",
    ),
    "telemetry.processes": ToolSpec(
        lambda filter="claude|python|node": [p.model_dump(mode="json") for p in telemetry.processes(filter)],
        "List matching processes. args: filter (regex, optional).",
    ),
    "memory.upsert_node": ToolSpec(
        memory_service.upsert_node,
        "Store a memory node. args: kind (Project|Conversation|Insight|...), props (dict).",
    ),
    "memory.link": ToolSpec(
        lambda a, rel, b: memory_service.link(a, rel, b) or {"linked": [a, rel, b]},
        "Link two memory nodes. args: a, rel (RUNS_ON|BELONGS_TO|ABOUT|USES|APPLIES_TO|MENTIONS), b.",
    ),
    "memory.search": ToolSpec(
        lambda query, k=5: [h.model_dump(mode="json") for h in memory_service.search(query, k)],
        "Hybrid semantic search over graph memory. args: query, k.",
    ),
}


def tool_catalog() -> str:
    return "\n".join(f"- {name}: {spec.description}" for name, spec in TOOLS.items())
