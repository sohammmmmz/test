import asyncio

import structlog
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.deps import require_auth, ws_auth
from app.models.schemas import DeviceInfo, ProcessInfo
from app.services import telemetry
from app.settings import settings

log = structlog.get_logger()
router = APIRouter()


@router.get("/api/health/device", response_model=DeviceInfo, dependencies=[Depends(require_auth)])
def device() -> DeviceInfo:
    return telemetry.device_info()


@router.get("/api/health/processes", response_model=list[ProcessInfo], dependencies=[Depends(require_auth)])
def processes(filter: str = r"claude|python|node") -> list[ProcessInfo]:
    return telemetry.processes(filter)


@router.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    if not await ws_auth(ws):
        return
    try:
        while True:
            snap = await asyncio.to_thread(telemetry.snapshot)
            procs = await asyncio.to_thread(telemetry.processes)
            await ws.send_json(
                {
                    "type": "telemetry",
                    "snapshot": snap.model_dump(mode="json"),
                    "processes": [p.model_dump(mode="json") for p in procs[:15]],
                }
            )
            await asyncio.sleep(settings.telemetry_interval_s)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("telemetry.ws_error", error=str(exc))
