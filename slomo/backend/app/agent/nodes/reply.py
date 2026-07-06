"""Synthesizes SloMo's final answer and writes the turn into graph memory."""

import json
import uuid
from datetime import datetime, timezone

from app.agent.llm import get_llm
from app.agent.prompts.slomo_persona import REPLY_PROMPT, SLOMO_SYSTEM_PROMPT
from app.agent.state import SloMoState
from app.services.memory import memory_service


def _template_reply(state: SloMoState) -> str:
    results = state.get("tool_results", [])
    if not results:
        return (
            "Heyyy, SloMo here. 🦥 I'm awake (slowly). Ask me about the Jetson's "
            "health, your projects, or tell me to spin up a Claude session."
        )
    lines = []
    for r in results:
        if r["ok"]:
            payload = json.dumps(r["result"], default=str)
            lines.append(f"✅ {r['name']}: {payload[:600]}")
        else:
            lines.append(f"❌ {r['name']}: {r['error']}")
    return "Here's what I did:\n" + "\n".join(lines)


def _summarize_turn(state: SloMoState, reply_text: str) -> None:
    summary = f"user: {state['user_input'][:200]} | slomo: {reply_text[:200]}"
    conv_id = memory_service.upsert_node(
        "Conversation",
        {"id": uuid.uuid4().hex[:12], "summary": summary, "embedding_id": "",
         "ts": datetime.now(timezone.utc).isoformat()},
    )
    active = state.get("active_project")
    if active:
        try:
            memory_service.link(conv_id, "ABOUT", active)
        except Exception:
            pass


def reply(state: SloMoState) -> dict:
    llm = get_llm()
    if llm is None:
        text = _template_reply(state)
    else:
        prompt = REPLY_PROMPT.format(
            persona=SLOMO_SYSTEM_PROMPT,
            channel=state.get("channel", "text"),
            user_input=state["user_input"],
            recalled_context=json.dumps(state.get("recalled_context", []), default=str)[:3000],
            tool_results=json.dumps(state.get("tool_results", []), default=str)[:6000],
        )
        text = str(llm.invoke(prompt).content)
    _summarize_turn(state, text)
    return {"reply": text}
