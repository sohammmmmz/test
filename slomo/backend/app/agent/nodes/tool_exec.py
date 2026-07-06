"""Executes one planned tool call per visit; the graph loops back here until
the plan is exhausted. Destructive tools pause with a LangGraph interrupt and
resume only when the client confirms."""

import time

from langgraph.types import interrupt

from app.agent.state import SloMoState
from app.agent.tools.registry import TOOLS


def tool_exec(state: SloMoState) -> dict:
    plan = state.get("plan", [])
    results = list(state.get("tool_results", []))
    call = plan[len(results)]
    name, args = call["name"], call.get("args", {})
    spec = TOOLS[name]

    if spec.destructive:
        approved = interrupt(
            {"type": "confirm", "tool": name, "args": args,
             "message": f"SloMo wants to run destructive tool {name}({args}). Confirm?"}
        )
        if not approved:
            results.append({"name": name, "ok": False, "result": None,
                            "error": "user declined confirmation", "latency_ms": 0})
            return {"tool_results": results}

    start = time.perf_counter()
    try:
        result = spec.fn(**args)
        results.append({"name": name, "ok": True, "result": result, "error": None,
                        "latency_ms": round((time.perf_counter() - start) * 1000, 1)})
    except Exception as exc:
        results.append({"name": name, "ok": False, "result": None, "error": str(exc),
                        "latency_ms": round((time.perf_counter() - start) * 1000, 1)})
    return {"tool_results": results}
