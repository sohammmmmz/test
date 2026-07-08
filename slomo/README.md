# 🦥 SloMo — Virtual Pet & Command Center

Always-on, personality-driven AI command center for a home **NVIDIA Jetson Orion
Nano**. One sloth, three screens: device **Health**, a **Chat** with a
LangGraph-orchestrated agent (text + Gemini Live voice), and a **Workspace**
explorer that creates, resumes and controls **Claude Code** sessions.

Built per the Technical BRD v2.0 (06 Jul 2026).

## Layout

```
slomo/
├─ backend/          FastAPI (Py 3.12) + LangGraph agent + services
│  └─ app/
│     ├─ api/        REST + WS routers (health, chat, projects, sessions, memory, gemini token)
│     ├─ agent/      SloMoGraph: router → memory_recall → planner → tool_exec ⟲ → reply
│     ├─ services/   session_manager (Claude PTYs), workspace, telemetry, memory (Kùzu+Chroma)
│     └─ observability/  Langfuse + structlog
├─ frontend/         Next.js 15 (App Router, React 19, TS, Tailwind)
│  ├─ app/           /health · /chat · /workspace · /workspace/[projectId]
│  ├─ lib/           api/WS clients · gemini-live (browser port) · audio (PCM/worklet)
│  └─ components/    SlothAvatar · VoiceButton · HealthCards · Tilt · CanopyBackdrop · …
├─ mobile/           Expo (React Native 0.86, expo-router, Reanimated 4)
│  └─ src/app/       tabs: Health · Chat · Workspace + session/[id] + settings modals
├─ docker-compose.yml   backend + frontend (+ optional langfuse profile)
└─ systemd/slomo.service
```

## Quick start (dev)

```bash
# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e .                 # add: -e '.[memory]' for Kùzu+Chroma, '.[jetson]' on the Jetson, '.[voice]' for Gemini tokens
cp .env.example .env             # set SLOMO_AUTH_TOKEN, keys
uvicorn app.main:app --reload --port 8000

# frontend
cd frontend
npm install
cp .env.local.example .env.local # match the auth token
npm run dev                      # http://localhost:3000

# mobile (Expo)
cd mobile
npm install
npx expo start                   # scan the QR with Expo Go, or press w for web preview
# then set backend URL + token in the app: Health tab → ⚙
```

The mobile app talks to the same backend over REST + WebSockets: live
telemetry tiles you can pick up (touch-driven 3D tilt with haptics), the
SloMo chat with destructive-tool confirm cards, and per-project Claude
terminals as slide-up sheets. The web UI layers the same identity with
pointer-tracked card tilt, a firefly canopy backdrop, and "unfurl" page
transitions — all spring-based and reduced-motion safe.

Without an `SLOMO_ANTHROPIC_API_KEY` the agent runs in **degraded heuristic
mode** (intent regexes + canned plans) — everything still works, the prose is
just less charming. Without Kùzu/Chroma installed, memory falls back to a
JSON-persisted in-memory graph.

## Deploy on the Jetson

```bash
sudo cp systemd/slomo.service /etc/systemd/system/
sudo systemctl enable --now slomo
# optional self-hosted Langfuse on :3001
docker compose --profile observability up -d
```

## Security model (Phase 1)

- LAN-only; single bearer token (`SLOMO_AUTH_TOKEN`) on every REST call and as
  `?token=` on WebSockets.
- The **Gemini API key never reaches the browser** — `/api/gemini/token` mints
  single-use, rate-limited ephemeral tokens (TTL ≈ 25 min).
- Destructive tools (`workspace.delete_project`, `session.kill`) pause on a
  LangGraph interrupt until the UI confirms.

## Voice pipeline (two-agent handshake)

```
mic ─► Gemini Live (voice I/O + transcription only)
          └─ transcript ─► /ws/chat ─► SloMoGraph (tools, memory)
                                          └─ reply ─► chat bubble
                                                   └─► gemini.narrate() → sloth voice
```

## Phase status

- **P0/P1/P2** scaffolded and runnable: telemetry WS, workspace + sessions,
  SloMoGraph with memory and Langfuse hooks, full UI.
- **P3** voice: implemented (needs `SLOMO_GEMINI_API_KEY` + `[voice]` extra).
- **P4** pending: Monaco viewer (plain viewer shipped), Rive avatar (CSS sloth
  shipped with the same `data-state` contract), Langfuse dashboards.
