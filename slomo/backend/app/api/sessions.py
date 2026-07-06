import asyncio

import structlog
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.deps import require_auth, ws_auth
from app.models.schemas import SessionInfo
from app.observability.langfuse_setup import log_generation
from app.services.session_manager import session_manager

log = structlog.get_logger()
router = APIRouter()


@router.get("/api/sessions", response_model=list[SessionInfo], dependencies=[Depends(require_auth)])
def list_sessions() -> list[SessionInfo]:
    return session_manager.status_all()


@router.delete("/api/sessions/{session_id}", status_code=204, dependencies=[Depends(require_auth)])
def kill_session(session_id: str) -> None:
    try:
        session_manager.kill(session_id)
    except KeyError:
        raise HTTPException(404, f"no such session: {session_id}")


@router.websocket("/ws/sessions/{session_id}")
async def ws_session(ws: WebSocket, session_id: str) -> None:
    """Bidirectional bridge: browser ⇄ Claude Code PTY."""
    await ws.accept()
    if not await ws_auth(ws):
        return
    session = session_manager.get(session_id)
    if session is None:
        await ws.close(code=4404, reason="no such session")
        return

    queue = session.subscribe()
    backlog = session.backlog()
    if backlog:
        await ws.send_json({"type": "output", "data": backlog[-16384:]})

    async def pump_output() -> None:
        while True:
            data = await queue.get()
            await ws.send_json({"type": "output", "data": data})

    pump = asyncio.create_task(pump_output())
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "input":
                text = msg.get("data", "")
                session.send(text)
                if text.strip():
                    log_generation(
                        name="claude-session-input", model="claude-code",
                        input_text=text, output_text="", session_id=session_id,
                    )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("session.ws_error", session=session_id, error=str(exc))
    finally:
        pump.cancel()
        session.unsubscribe(queue)
