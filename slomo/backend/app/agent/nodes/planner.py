"""LLM planner: chooses tool calls from the registry. Heuristic fallback
covers the common intents when no LLM key is configured."""

import json
import re

from app.agent.llm import get_llm
from app.agent.prompts.slomo_persona import PLANNER_PROMPT
from app.agent.state import SloMoState
from app.agent.tools.registry import TOOLS, tool_catalog


def _extract_name(text: str) -> str | None:
    m = re.search(r"(?:called|named)\s+['\"]?([\w][\w\- ]{0,40})['\"]?", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"['\"]([\w][\w\- ]{0,40})['\"]", text)
    return m.group(1).strip() if m else None


def _heuristic_plan(state: SloMoState) -> list[dict]:
    intent = state.get("intent")
    text = state["user_input"]
    if intent == "system_query":
        plan = [{"name": "telemetry.snapshot", "args": {}}]
        if re.search(r"\bprocess", text, re.IGNORECASE):
            plan.append({"name": "telemetry.processes", "args": {}})
        return plan
    if intent == "query_project":
        return [
            {"name": "workspace.list_projects", "args": {}},
            {"name": "session.status_all", "args": {}},
        ]
    if intent == "memory_query":
        return [{"name": "memory.search", "args": {"query": text, "k": 5}}]
    if intent == "create_project":
        name = _extract_name(text)
        if name:
            template = "python"
            for t in ("fastapi", "react", "node", "python", "blank"):
                if t in text.lower():
                    template = t
                    break
            return [{"name": "workspace.create_project", "args": {"name": name, "template": template}}]
        return [{"name": "workspace.list_projects", "args": {}}]
    if intent == "resume_project":
        project = state.get("active_project") or _extract_name(text)
        if re.search(r"\b(kill|stop|terminate)\b", text, re.IGNORECASE):
            return [{"name": "session.status_all", "args": {}}]
        if project:
            return [{"name": "session.start", "args": {"project_id": project}}]
        return [{"name": "workspace.list_projects", "args": {}}]
    return []


def planner(state: SloMoState) -> dict:
    llm = get_llm()
    if llm is None:
        return {"plan": _heuristic_plan(state), "tool_results": []}

    prompt = PLANNER_PROMPT.format(
        tool_catalog=tool_catalog(),
        recalled_context=json.dumps(state.get("recalled_context", []), default=str)[:4000],
        intent=state.get("intent"),
        user_input=state["user_input"],
    )
    raw = str(llm.invoke(prompt).content)
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    plan: list[dict] = []
    if m:
        try:
            for call in json.loads(m.group(0)):
                if isinstance(call, dict) and call.get("name") in TOOLS:
                    plan.append({"name": call["name"], "args": call.get("args", {})})
        except json.JSONDecodeError:
            plan = _heuristic_plan(state)
    return {"plan": plan, "tool_results": []}
