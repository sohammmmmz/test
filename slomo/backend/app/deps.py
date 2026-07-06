from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.settings import settings

_bearer = HTTPBearer(auto_error=False)


def require_auth(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    if creds is None or creds.credentials != settings.auth_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or missing bearer token")


async def ws_auth(ws: WebSocket) -> bool:
    """WS auth via ?token= query param (browsers can't set WS headers)."""
    token = ws.query_params.get("token")
    if token != settings.auth_token:
        await ws.close(code=4401, reason="unauthorized")
        return False
    return True
