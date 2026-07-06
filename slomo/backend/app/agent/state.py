from typing import Any, Literal, Optional, TypedDict

Intent = Literal[
    "chitchat",
    "create_project",
    "resume_project",
    "query_project",
    "system_query",
    "memory_query",
]


class SloMoState(TypedDict, total=False):
    user_input: str
    channel: Literal["text", "voice"]
    intent: Optional[Intent]
    active_project: Optional[str]
    recalled_context: list[dict[str, Any]]  # serialized MemoryHit
    plan: list[dict[str, Any]]  # serialized ToolCall
    tool_results: list[dict[str, Any]]  # serialized ToolResult
    reply: str
    trace_id: str
