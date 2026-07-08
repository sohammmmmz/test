import asyncio
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, gemini_token, health, memory, projects, sessions
from app.observability.logging import configure_logging
from app.services.memory import memory_service
from app.services.session_manager import session_manager
from app.settings import settings

configure_logging()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    session_manager.loop = asyncio.get_running_loop()
    device_id = memory_service.bootstrap_device_node()
    log.info("slomo.boot", device=device_id, workspace=str(settings.workspace_dir))
    yield
    log.info("slomo.shutdown")


app = FastAPI(title="SloMo Command Center", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (health.router, chat.router, projects.router, sessions.router, memory.router, gemini_token.router):
    app.include_router(r)


@app.get("/api/ping")
def ping() -> dict:
    return {"ok": True, "service": "slomo"}
