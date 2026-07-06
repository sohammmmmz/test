"""Langfuse wiring.

Every /ws/chat turn becomes a root trace; LangGraph nodes, tool calls and LLM
generations are captured by the CallbackHandler passed into graph.astream.
Fully optional: without keys configured, handlers are None and tracing is off.
"""

import structlog

from app.settings import settings

log = structlog.get_logger()

_langfuse = None

if settings.langfuse_public_key and settings.langfuse_secret_key:
    try:
        from langfuse import Langfuse

        _langfuse = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
        log.info("langfuse.enabled", host=settings.langfuse_host)
    except Exception as exc:  # pragma: no cover
        log.warning("langfuse.init_failed", error=str(exc))


def get_langfuse():
    return _langfuse


def langgraph_handler(session_id: str, user_id: str = "soham"):
    """CallbackHandler for graph.astream(config={"callbacks": [...]})."""
    if _langfuse is None:
        return None
    from langfuse.callback import CallbackHandler

    return CallbackHandler(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
        session_id=session_id,
        user_id=user_id,
        tags=["slomo", "langgraph"],
    )


def log_generation(name: str, model: str, input_text: str, output_text: str, session_id: str) -> None:
    """Server-side record of non-LangGraph generations (Claude PTY turns, Gemini Live transcripts)."""
    if _langfuse is None:
        return
    trace = _langfuse.trace(name=name, session_id=session_id, tags=["slomo"])
    trace.generation(name=name, model=model, input=input_text, output=output_text)


def log_score(trace_id: str, name: str, value: float, comment: str = "") -> None:
    if _langfuse is None:
        return
    _langfuse.score(trace_id=trace_id, name=name, value=value, comment=comment)
