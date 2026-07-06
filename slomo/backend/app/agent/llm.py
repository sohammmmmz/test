"""LLM factory for the SloMo agent (planner / router / reply nodes).

Returns None when no Anthropic key is configured — every node has a
heuristic fallback so the stack still runs (degraded) without a key.
"""

from functools import lru_cache

from app.settings import settings


@lru_cache(maxsize=1)
def get_llm():
    if not settings.anthropic_api_key:
        return None
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(
        model=settings.agent_model,
        api_key=settings.anthropic_api_key,
        max_tokens=2048,
        temperature=0.3,
    )
