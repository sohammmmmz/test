from fastapi import APIRouter, Depends

from app.deps import require_auth
from app.models.schemas import MemoryHit, MemorySearchRequest
from app.services.memory import memory_service

router = APIRouter(prefix="/api/memory", dependencies=[Depends(require_auth)])


@router.get("/graph")
def graph(node_id: str) -> dict:
    return memory_service.node_with_neighbors(node_id)


@router.post("/search", response_model=list[MemoryHit])
def search(req: MemorySearchRequest) -> list[MemoryHit]:
    return memory_service.search(req.query, req.k)
