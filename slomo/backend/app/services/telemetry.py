"""Device telemetry.

Prefers Jetson-native sources (jtop / tegrastats) and falls back to psutil so
the backend also runs on dev machines that are not a Jetson.
"""

import platform
import re
import socket
import time
from pathlib import Path
from typing import Any

import psutil

from app.models.schemas import DeviceInfo, ProcessInfo, TelemetrySnapshot

try:  # jetson-stats — only present on a Jetson
    from jtop import jtop  # type: ignore

    HAS_JTOP = True
except ImportError:
    HAS_JTOP = False

_BOOT_TIME = psutil.boot_time()


def _gpu_snapshot() -> dict[str, Any] | None:
    if not HAS_JTOP:
        return None
    try:
        with jtop() as jetson:
            if jetson.ok():
                stats = jetson.stats
                return {
                    "gpu_percent": stats.get("GPU"),
                    "power_mw": stats.get("Power TOT"),
                    "nvp_model": str(jetson.nvpmodel) if jetson.nvpmodel else None,
                }
    except Exception:
        return None
    return None


def _temps() -> dict[str, float]:
    temps: dict[str, float] = {}
    try:
        for name, entries in psutil.sensors_temperatures().items():
            for i, entry in enumerate(entries):
                label = entry.label or (name if i == 0 else f"{name}_{i}")
                if entry.current is not None:
                    temps[label] = round(entry.current, 1)
    except Exception:
        pass
    return temps


def _disks() -> list[dict[str, Any]]:
    disks = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        disks.append(
            {
                "mount": part.mountpoint,
                "total_gb": round(usage.total / 1e9, 1),
                "used_gb": round(usage.used / 1e9, 1),
                "percent": usage.percent,
            }
        )
    return disks


def snapshot() -> TelemetrySnapshot:
    mem = psutil.virtual_memory()
    return TelemetrySnapshot(
        ts=time.time(),
        cpu_percent=psutil.cpu_percent(interval=None),
        per_cpu=psutil.cpu_percent(interval=None, percpu=True),
        mem_percent=mem.percent,
        mem_used_gb=round(mem.used / 1e9, 2),
        mem_total_gb=round(mem.total / 1e9, 2),
        swap_percent=psutil.swap_memory().percent,
        disk=_disks(),
        temps=_temps(),
        load_avg=psutil.getloadavg(),
        gpu=_gpu_snapshot(),
    )


def processes(pattern: str = r"claude|python|node") -> list[ProcessInfo]:
    rx = re.compile(pattern, re.IGNORECASE)
    out: list[ProcessInfo] = []
    for proc in psutil.process_iter(["pid", "name", "cmdline", "cpu_percent", "memory_info", "status"]):
        try:
            info = proc.info
            cmdline = " ".join(info.get("cmdline") or [])
            if not (rx.search(info["name"] or "") or rx.search(cmdline)):
                continue
            out.append(
                ProcessInfo(
                    pid=info["pid"],
                    name=info["name"] or "?",
                    cmdline=cmdline[:200],
                    cpu_percent=info.get("cpu_percent") or 0.0,
                    mem_mb=round((info["memory_info"].rss if info.get("memory_info") else 0) / 1e6, 1),
                    status=info.get("status") or "?",
                )
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return sorted(out, key=lambda p: p.mem_mb, reverse=True)


def _jetpack_version() -> str | None:
    release = Path("/etc/nv_tegra_release")
    if release.exists():
        return release.read_text().splitlines()[0].strip()
    return None


def _cuda_version() -> str | None:
    version_file = Path("/usr/local/cuda/version.json")
    if version_file.exists():
        m = re.search(r'"version"\s*:\s*"([^"]+)"', version_file.read_text())
        return m.group(1) if m else None
    return None


def _lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def device_info() -> DeviceInfo:
    model_path = Path("/sys/firmware/devicetree/base/model")
    model = model_path.read_text().strip("\x00") if model_path.exists() else platform.machine()
    return DeviceInfo(
        hostname=socket.gethostname(),
        model=model,
        os=f"{platform.system()} {platform.release()}",
        jetpack=_jetpack_version(),
        cuda=_cuda_version(),
        ram_gb=round(psutil.virtual_memory().total / 1e9, 1),
        storage=_disks(),
        ip=_lan_ip(),
        uptime_s=time.time() - _BOOT_TIME,
    )
