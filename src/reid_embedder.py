"""Re-ID embedding extractor.

This produces an appearance vector for each person crop. These vectors are the
backbone of the *global* identity layer: the same physical person produces
similar vectors across cameras and across time, even after the per-camera
tracker loses and re-acquires them.

We reuse BoxMOT's appearance backend so the exact same model family (e.g.
CLIP-ReID) can be used both inside BoT-SORT and in the global fusion layer.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

# BoxMOT has moved this class around across versions. Try the known locations
# so a minor version bump doesn't break the import. We pin boxmot==13.0.17 in
# requirements.txt (where the first path is correct), but stay defensive.
try:                                                              # boxmot 13.x
    from boxmot.appearance.reid.auto_backend import ReidAutoBackend
except ModuleNotFoundError:
    try:                                                          # boxmot 16.x
        from boxmot.reid.core.auto_backend import ReidAutoBackend
    except ModuleNotFoundError:                                   # boxmot <=12.x
        from boxmot.appearance.reid_auto_backend import ReidAutoBackend


class ReidEmbedder:
    def __init__(self, weights: str, device: str = "cuda:0", half: bool = True):
        backend = ReidAutoBackend(weights=Path(weights), device=device, half=half)
        self.model = backend.model

    def __call__(self, xyxy: np.ndarray, frame: np.ndarray) -> np.ndarray:
        """Return L2-normalized embeddings, shape (N, D), for boxes xyxy (N, 4)."""
        if xyxy is None or len(xyxy) == 0:
            return np.empty((0, 0), dtype=np.float32)
        feats = self.model.get_features(xyxy.astype(np.float32), frame)
        feats = np.asarray(feats, dtype=np.float32)
        norms = np.linalg.norm(feats, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return feats / norms
