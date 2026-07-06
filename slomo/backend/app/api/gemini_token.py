"""Mints short-lived ephemeral Gemini Live tokens so the real API key never
reaches the browser. Requires the `voice` extra (google-genai)."""

import time

from fastapi import APIRouter, Depends, HTTPException

from app.deps import require_auth
from app.settings import settings

router = APIRouter(prefix="/api/gemini", dependencies=[Depends(require_auth)])

_RATE_WINDOW_S = 60
_RATE_MAX = 10
_recent: list[float] = []


@router.post("/token")
def mint_token() -> dict:
    if not settings.gemini_api_key:
        raise HTTPException(503, "SLOMO_GEMINI_API_KEY not configured")

    now = time.time()
    _recent[:] = [t for t in _recent if now - t < _RATE_WINDOW_S]
    if len(_recent) >= _RATE_MAX:
        raise HTTPException(429, "token mint rate limit exceeded")
    _recent.append(now)

    try:
        from google import genai
    except ImportError:
        raise HTTPException(501, "google-genai not installed (pip install 'slomo-backend[voice]')")

    client = genai.Client(
        api_key=settings.gemini_api_key,
        http_options={"api_version": "v1alpha"},  # auth_tokens requires v1alpha
    )
    expire = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + settings.gemini_token_ttl_s))
    token = client.auth_tokens.create(
        config={
            "uses": 1,
            "expire_time": expire,
            "live_connect_constraints": {"model": settings.gemini_live_model},
        }
    )
    return {"token": token.name, "model": settings.gemini_live_model, "expires_at": expire}
