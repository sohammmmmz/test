"""SloMoGraph — the LangGraph orchestrator.

START ─► router ─► memory_recall ─► planner ─► tool_exec ─► reply ─► END
              │chitchat────────────────────────────►▲          ▲
              └────────────────────► reply          └──(loop while plan
                                                        not exhausted)
"""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.agent import nodes
from app.agent.state import SloMoState
from app.settings import settings


def _after_router(state: SloMoState) -> str:
    return "reply" if state.get("intent") == "chitchat" else "memory_recall"


def _after_planner(state: SloMoState) -> str:
    return "tool_exec" if state.get("plan") else "reply"


def _after_tool_exec(state: SloMoState) -> str:
    if len(state.get("tool_results", [])) < len(state.get("plan", [])):
        return "tool_exec"
    return "reply"


def build_graph():
    builder = StateGraph(SloMoState)
    builder.add_node("router", nodes.router)
    builder.add_node("memory_recall", nodes.memory_recall)
    builder.add_node("planner", nodes.planner)
    builder.add_node("tool_exec", nodes.tool_exec)
    builder.add_node("reply", nodes.reply)

    builder.add_edge(START, "router")
    builder.add_conditional_edges("router", _after_router, ["memory_recall", "reply"])
    builder.add_edge("memory_recall", "planner")
    builder.add_conditional_edges("planner", _after_planner, ["tool_exec", "reply"])
    builder.add_conditional_edges("tool_exec", _after_tool_exec, ["tool_exec", "reply"])
    builder.add_edge("reply", END)

    # MemorySaver checkpointer is required for the interrupt/resume confirm flow.
    return builder.compile(checkpointer=MemorySaver())


slomo_graph = build_graph()


def graph_config(thread_id: str, callbacks: list | None = None) -> dict:
    config: dict = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": settings.agent_recursion_limit,
    }
    if callbacks:
        config["callbacks"] = callbacks
    return config
