"""Filesystem operations on the managed workspace directory (~/workspace)."""

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.models.schemas import Project, ProjectCreate
from app.settings import settings

_META_FILE = ".slomo.json"

_TEMPLATES: dict[str, dict[str, str]] = {
    "blank": {"README.md": "# {name}\n"},
    "python": {
        "README.md": "# {name}\n",
        "main.py": 'def main() -> None:\n    print("hello from {name}")\n\n\nif __name__ == "__main__":\n    main()\n',
        "pyproject.toml": '[project]\nname = "{slug}"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n',
    },
    "node": {
        "README.md": "# {name}\n",
        "index.js": 'console.log("hello from {name}");\n',
        "package.json": '{{\n  "name": "{slug}",\n  "version": "0.1.0",\n  "type": "module"\n}}\n',
    },
    "fastapi": {
        "README.md": "# {name}\n",
        "main.py": (
            "from fastapi import FastAPI\n\napp = FastAPI(title=\"{name}\")\n\n\n"
            "@app.get(\"/\")\ndef root():\n    return {{\"hello\": \"{name}\"}}\n"
        ),
        "pyproject.toml": '[project]\nname = "{slug}"\nversion = "0.1.0"\ndependencies = ["fastapi", "uvicorn"]\n',
    },
    "react": {
        "README.md": "# {name}\n\nScaffold with `npm create vite@latest . -- --template react-ts`.\n",
    },
}


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or uuid.uuid4().hex[:8]


def _load_meta(path: Path) -> dict:
    meta_path = path / _META_FILE
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def _project_from_dir(path: Path) -> Project:
    meta = _load_meta(path)
    stat = path.stat()
    return Project(
        id=meta.get("id", path.name),
        name=meta.get("name", path.name),
        path=str(path),
        stack=meta.get("stack", "blank"),
        description=meta.get("description", ""),
        created_at=meta.get("created_at", datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)),
        last_active=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        tags=meta.get("tags", []),
    )


def list_projects() -> list[Project]:
    settings.workspace_dir.mkdir(parents=True, exist_ok=True)
    return sorted(
        (_project_from_dir(p) for p in settings.workspace_dir.iterdir() if p.is_dir() and not p.name.startswith(".")),
        key=lambda p: p.last_active or p.created_at,
        reverse=True,
    )


def get_project(project_id: str) -> Project | None:
    for project in list_projects():
        if project.id == project_id:
            return project
    return None


def create_project(spec: ProjectCreate) -> Project:
    slug = _slugify(spec.name)
    path = settings.workspace_dir / slug
    if path.exists():
        raise FileExistsError(f"project directory already exists: {slug}")
    path.mkdir(parents=True)
    for rel, content in _TEMPLATES.get(spec.template, _TEMPLATES["blank"]).items():
        (path / rel).write_text(content.format(name=spec.name, slug=slug))
    meta = {
        "id": slug,
        "name": spec.name,
        "stack": spec.template,
        "description": spec.description,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tags": [],
    }
    (path / _META_FILE).write_text(json.dumps(meta, indent=2))
    return _project_from_dir(path)


def delete_project(project_id: str) -> None:
    project = get_project(project_id)
    if project is None:
        raise FileNotFoundError(project_id)
    shutil.rmtree(project.path)


def _safe_resolve(project: Project, rel_path: str) -> Path:
    root = Path(project.path).resolve()
    target = (root / rel_path).resolve()
    if not target.is_relative_to(root):
        raise PermissionError("path escapes project root")
    return target


def list_files(project_id: str, max_entries: int = 500) -> list[dict]:
    project = get_project(project_id)
    if project is None:
        raise FileNotFoundError(project_id)
    root = Path(project.path)
    entries = []
    for p in sorted(root.rglob("*")):
        if any(part.startswith(".") or part == "node_modules" for part in p.relative_to(root).parts):
            continue
        entries.append({"path": str(p.relative_to(root)), "dir": p.is_dir(), "size": p.stat().st_size if p.is_file() else 0})
        if len(entries) >= max_entries:
            break
    return entries


def read_file(project_id: str, rel_path: str, max_bytes: int = 200_000) -> str:
    project = get_project(project_id)
    if project is None:
        raise FileNotFoundError(project_id)
    target = _safe_resolve(project, rel_path)
    return target.read_text(errors="replace")[:max_bytes]
