"""Intent classification. chitchat short-circuits straight to reply."""

import re

from app.agent.llm import get_llm
from app.agent.prompts.slomo_persona import ROUTER_PROMPT
from app.agent.state import Intent, SloMoState

_VALID: set[str] = {
    "chitchat", "create_project", "resume_project",
    "query_project", "system_query", "memory_query",
}

_HEURISTICS: list[tuple[str, Intent]] = [
    (r"\b(create|new|scaffold|start a) (a |new )?(project|app|repo)\b", "create_project"),
    (r"\b(resume|attach|continue|open|reopen)\b.*\b(project|session|claude)\b", "resume_project"),
    (r"\b(kill|stop|terminate)\b.*\b(session|claude|pid)\b", "resume_project"),
    (r"\b(temp|thermal|cpu|gpu|ram|memory usage|storage|disk|uptime|process|health|hot|status)\b", "system_query"),
    (r"\b(remember|memory|recall|last time|previously|insight)\b", "memory_query"),
    (r"\b(project|workspace|session|file)s?\b", "query_project"),
]


def _heuristic(text: str) -> Intent:
    for pattern, intent in _HEURISTICS:
        if re.search(pattern, text, re.IGNORECASE):
            return intent
    return "chitchat"


def router(state: SloMoState) -> dict:
    text = state["user_input"]
    llm = get_llm()
    if llm is not None:
        raw = llm.invoke(ROUTER_PROMPT.format(user_input=text)).content
        label = str(raw).strip().lower().split()[0].strip(".,\"'")
        if label in _VALID:
            return {"intent": label}
    return {"intent": _heuristic(text)}
