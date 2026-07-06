"""/ws/chat — the SloMo (LangGraph) conversation stream.

Protocol (JSON frames):
  client → server: {"type": "user", "text": "...", "channel": "text"|"voice"}
                   {"type": "confirm", "confirm": true|false}   (resume after interrupt)
  server → client: {"type": "state", "state": "thinking"|"working"|"speaking"|"idle"}
                   {"type": "node", "name": "..."}              (graph progress)
                   {"type": "confirm_request", "tool": ..., "args": ..., "message": ...}
                   {"type": "reply", "text": "...", "trace_id": "..."}
                   {"type": "error", "error": "..."}
"""

import uuid

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from langgraph.types import Command

from app.agent.graph import graph_config, slomo_graph
from app.deps import ws_auth
from app.observability.langfuse_setup import langgraph_handler

log = structlog.get_logger()
router = APIRouter()


async def _run_graph(ws: WebSocket, graph_input, config: dict) -> None:
    """Stream one graph run; recurses via Command(resume=...) on interrupts."""
    interrupted = False
    async for update in slomo_graph.astream(graph_input, config=config, stream_mode="updates"):
        if "__interrupt__" in update:
            payload = update["__interrupt__"][0].value
            await ws.send_json({"type": "confirm_request", **payload})
            interrupted = True
            continue
        for node_name, node_update in update.items():
            await ws.send_json({"type": "node", "name": node_name})
            if node_name == "reply" and node_update.get("reply"):
                await ws.send_json(
                    {"type": "reply", "text": node_update["reply"],
                     "trace_id": config["configurable"]["thread_id"]}
                )
    if interrupted:
        # Wait for the client's confirm frame, then resume the same thread.
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "confirm":
                await _run_graph(ws, Command(resume=bool(msg.get("confirm"))), config)
                return


@router.websocket("/ws/chat")
async def ws_chat(ws: WebSocket) -> None:
    await ws.accept()
    if not await ws_auth(ws):
        return
    conversation_id = uuid.uuid4().hex[:12]
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") != "user":
                continue
            turn_id = f"{conversation_id}-{uuid.uuid4().hex[:6]}"
            handler = langgraph_handler(session_id=conversation_id)
            config = graph_config(thread_id=turn_id, callbacks=[handler] if handler else None)
            await ws.send_json({"type": "state", "state": "thinking"})
            try:
                await _run_graph(
                    ws,
                    {"user_input": msg.get("text", ""),
                     "channel": msg.get("channel", "text"),
                     "trace_id": turn_id},
                    config,
                )
            except Exception as exc:
                log.exception("chat.graph_error")
                await ws.send_json({"type": "error", "error": str(exc)})
            await ws.send_json({"type": "state", "state": "idle"})
    except WebSocketDisconnect:
        pass
