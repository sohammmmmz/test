from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class DeviceInfo(BaseModel):
    hostname: str
    model: str
    os: str
    jetpack: str | None = None
    cuda: str | None = None
    ram_gb: float
    storage: list[dict[str, Any]]
    ip: str | None = None
    uptime_s: float


class TelemetrySnapshot(BaseModel):
    ts: float
    cpu_percent: float
    per_cpu: list[float]
    mem_percent: float
    mem_used_gb: float
    mem_total_gb: float
    swap_percent: float
    disk: list[dict[str, Any]]
    temps: dict[str, float]
    load_avg: tuple[float, float, float]
    gpu: dict[str, Any] | None = None


class ProcessInfo(BaseModel):
    pid: int
    name: str
    cmdline: str
    cpu_percent: float
    mem_mb: float
    status: str


class Project(BaseModel):
    id: str
    name: str
    path: str
    stack: str = "blank"
    description: str = ""
    created_at: datetime
    last_active: datetime | None = None
    tags: list[str] = []


class ProjectCreate(BaseModel):
    name: str
    template: Literal["blank", "python", "node", "fastapi", "react"] = "blank"
    description: str = ""


class SessionInfo(BaseModel):
    id: str
    project_id: str
    pid: int | None
    started_at: float
    status: Literal["running", "exited", "killed"]
    log_path: str | None = None
    unread_bytes: int = 0


class MemoryHit(BaseModel):
    node_id: str
    kind: str
    text: str
    score: float
    props: dict[str, Any] = {}


class MemorySearchRequest(BaseModel):
    query: str
    k: int = 5


class ChatClientMessage(BaseModel):
    """A message from the browser over /ws/chat."""

    type: Literal["user", "confirm"] = "user"
    text: str = ""
    channel: Literal["text", "voice"] = "text"
    confirm: bool | None = None


class ToolCall(BaseModel):
    name: str
    args: dict[str, Any] = {}


class ToolResult(BaseModel):
    name: str
    ok: bool
    result: Any = None
    error: str | None = None
    latency_ms: float = 0
