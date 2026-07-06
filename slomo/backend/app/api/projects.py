from fastapi import APIRouter, Depends, HTTPException

from app.agent.tools.registry import TOOLS
from app.deps import require_auth
from app.models.schemas import Project, ProjectCreate, SessionInfo
from app.services import workspace

router = APIRouter(prefix="/api/projects", dependencies=[Depends(require_auth)])


@router.get("", response_model=list[Project])
def list_projects() -> list[Project]:
    return workspace.list_projects()


@router.post("", response_model=Project, status_code=201)
def create_project(spec: ProjectCreate) -> Project:
    try:
        result = TOOLS["workspace.create_project"].fn(
            name=spec.name, template=spec.template, description=spec.description
        )
    except FileExistsError as exc:
        raise HTTPException(409, str(exc))
    return Project.model_validate(result)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    try:
        workspace.delete_project(project_id)
    except FileNotFoundError:
        raise HTTPException(404, f"no such project: {project_id}")


@router.get("/{project_id}/files")
def project_files(project_id: str) -> list[dict]:
    try:
        return workspace.list_files(project_id)
    except FileNotFoundError:
        raise HTTPException(404, f"no such project: {project_id}")


@router.get("/{project_id}/file")
def project_file(project_id: str, path: str) -> dict:
    try:
        return {"path": path, "content": workspace.read_file(project_id, path)}
    except FileNotFoundError:
        raise HTTPException(404, "not found")
    except PermissionError as exc:
        raise HTTPException(403, str(exc))


@router.post("/{project_id}/session", response_model=SessionInfo, status_code=201)
def start_session(project_id: str) -> SessionInfo:
    try:
        result = TOOLS["session.start"].fn(project_id=project_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(429, str(exc))
    return SessionInfo.model_validate(result)
