"""Claude Code session manager.

Each session is a `claude` CLI process inside a PTY, spawned with cwd set to a
project directory. A reader thread drains the PTY into a ring buffer (for
"unread since last view" badges) and fans chunks out to any number of
WebSocket subscribers via asyncio queues.
"""

import asyncio
import threading
import time
import uuid
from collections import deque

from ptyprocess import PtyProcessUnicode

from app.models.schemas import SessionInfo
from app.settings import settings


class ClaudeSession:
    def __init__(self, project_id: str, project_path: str, loop: asyncio.AbstractEventLoop):
        self.id = uuid.uuid4().hex[:12]
        self.project_id = project_id
        self.started_at = time.time()
        self.status = "running"
        self._loop = loop
        self._buffer: deque[str] = deque()
        self._buffer_bytes = 0
        self._unread_bytes = 0
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._lock = threading.Lock()
        self.log_path = settings.log_dir / f"session-{self.id}.log"
        self.pty = PtyProcessUnicode.spawn(
            [settings.claude_bin], cwd=project_path, dimensions=(40, 160)
        )
        threading.Thread(target=self._reader, name=f"pty-{self.id}", daemon=True).start()

    @property
    def pid(self) -> int | None:
        return self.pty.pid if self.status == "running" else None

    def _reader(self) -> None:
        max_bytes = settings.session_buffer_kb * 1024
        with open(self.log_path, "a", errors="replace") as log:
            while True:
                try:
                    data = self.pty.read(4096)
                except EOFError:
                    if self.status == "running":
                        self.status = "exited"
                    break
                log.write(data)
                log.flush()
                with self._lock:
                    self._buffer.append(data)
                    self._buffer_bytes += len(data)
                    self._unread_bytes += len(data)
                    while self._buffer_bytes > max_bytes and len(self._buffer) > 1:
                        self._buffer_bytes -= len(self._buffer.popleft())
                for q in list(self._subscribers):
                    self._loop.call_soon_threadsafe(q.put_nowait, data)

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=512)
        self._subscribers.add(q)
        with self._lock:
            self._unread_bytes = 0
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subscribers.discard(q)

    def backlog(self) -> str:
        with self._lock:
            self._unread_bytes = 0
            return "".join(self._buffer)

    def send(self, text: str) -> None:
        if self.status != "running":
            raise RuntimeError(f"session {self.id} is {self.status}")
        self.pty.write(text)

    def kill(self) -> None:
        if self.status == "running":
            self.status = "killed"
            try:
                self.pty.terminate(force=True)
            except Exception:
                pass

    def info(self) -> SessionInfo:
        return SessionInfo(
            id=self.id,
            project_id=self.project_id,
            pid=self.pid,
            started_at=self.started_at,
            status=self.status,  # type: ignore[arg-type]
            log_path=str(self.log_path),
            unread_bytes=self._unread_bytes,
        )


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, ClaudeSession] = {}

    def _running(self) -> list[ClaudeSession]:
        return [s for s in self._sessions.values() if s.status == "running"]

    def start(self, project_id: str, project_path: str) -> ClaudeSession:
        for s in self._running():
            if s.project_id == project_id:
                return s  # one live session per project
        if len(self._running()) >= settings.max_claude_sessions:
            raise RuntimeError(
                f"max concurrent Claude sessions reached ({settings.max_claude_sessions})"
            )
        session = ClaudeSession(project_id, project_path, asyncio.get_event_loop())
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> ClaudeSession | None:
        return self._sessions.get(session_id)

    def send(self, session_id: str, text: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        session.send(text)

    def kill(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        session.kill()

    def status_all(self) -> list[SessionInfo]:
        return [s.info() for s in self._sessions.values()]


session_manager = SessionManager()
