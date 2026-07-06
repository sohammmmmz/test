from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SLOMO_", env_file=".env", extra="ignore")

    # Paths (bind-mounted in docker; plain dirs on host dev)
    workspace_dir: Path = Path.home() / "workspace"
    data_dir: Path = Path.home() / ".slomo" / "db"
    log_dir: Path = Path.home() / ".slomo" / "logs"

    # Auth (Phase 1: single local bearer token)
    auth_token: str = "change-me"
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://slomo.local:3000",
    ]

    # Claude Code sessions
    claude_bin: str = "claude"
    max_claude_sessions: int = 3
    session_buffer_kb: int = 256

    # Telemetry
    telemetry_interval_s: float = 2.0

    # SloMo agent LLM
    agent_model: str = "claude-sonnet-5"
    anthropic_api_key: str | None = None
    agent_recursion_limit: int = 12

    # Gemini Live (key never leaves the backend; frontend gets ephemeral tokens)
    gemini_api_key: str | None = None
    gemini_live_model: str = "models/gemini-3.1-flash-live-preview"
    gemini_token_ttl_s: int = 60 * 25

    # Langfuse
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "http://localhost:3001"

    def ensure_dirs(self) -> None:
        for p in (self.workspace_dir, self.data_dir, self.log_dir):
            p.mkdir(parents=True, exist_ok=True)


settings = Settings()
