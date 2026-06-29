"""Per-camera tracking using BoxMOT (BoT-SORT / BoostTrack / Deep OC-SORT).

This layer keeps a person's id stable *within one camera stream*. We give it a
long lost-track buffer so brief occlusions or missed detections don't kill the
track. Anything it still gets wrong (a hard ID switch) is healed downstream by
the global identity layer.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np


def build_tracker(cfg: dict):
    """Construct a BoxMOT tracker from config. Returns the tracker instance."""
    ttype = cfg["type"].lower()
    weights = Path(cfg["reid_weights"])
    device = cfg.get("device", "cuda:0")
    half = cfg.get("half", True)

    common = dict(reid_weights=weights, device=device, half=half)

    if ttype == "botsort":
        from boxmot import BotSort
        tracker = BotSort(
            **common,
            track_high_thresh=cfg.get("track_high_thresh", 0.5),
            track_low_thresh=cfg.get("track_low_thresh", 0.1),
            new_track_thresh=cfg.get("new_track_thresh", 0.6),
            track_buffer=cfg.get("track_buffer", 90),   # KEY: keep lost tracks alive longer
            match_thresh=cfg.get("match_thresh", 0.8),
            with_reid=True,
        )
    elif ttype == "boosttrack":
        from boxmot import BoostTrack
        tracker = BoostTrack(**common)
    elif ttype == "deepocsort":
        from boxmot import DeepOcSort
        tracker = DeepOcSort(**common)
    else:
        raise ValueError(f"Unknown tracker type: {ttype}")
    return tracker


class CameraTracker:
    """Wraps a BoxMOT tracker and returns local tracks for a frame."""

    def __init__(self, name: str, cfg: dict):
        self.name = name
        self.tracker = build_tracker(cfg)

    def update(self, dets: np.ndarray, frame: np.ndarray) -> np.ndarray:
        """dets: (N,6) [x1,y1,x2,y2,conf,cls].
        Returns (M,8): [x1,y1,x2,y2,track_id,conf,cls,det_idx]."""
        if dets is None or len(dets) == 0:
            dets = np.empty((0, 6), dtype=np.float32)
        out = self.tracker.update(dets, frame)
        if out is None or len(out) == 0:
            return np.empty((0, 8), dtype=np.float32)
        return np.asarray(out, dtype=np.float32)
