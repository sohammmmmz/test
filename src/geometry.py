"""Ground-plane geometry helpers.

Each camera has a homography H that maps an image pixel (foot point of a person)
to a common floor coordinate system (the floor plan). Because every camera maps
into the *same* coordinate system, a person's floor position is comparable
across cameras: a person cannot be in two different floor locations at once.
This is what makes overlapping views a strength rather than a duplication.
"""
from __future__ import annotations

import numpy as np


def load_homography(path: str) -> np.ndarray:
    H = np.load(path)
    assert H.shape == (3, 3), f"Homography {path} must be 3x3, got {H.shape}"
    return H.astype(np.float64)


def foot_point(xyxy: np.ndarray) -> np.ndarray:
    """Foot point = bottom-center of a bounding box. Input (N,4) -> output (N,2)."""
    x1, y1, x2, y2 = xyxy[:, 0], xyxy[:, 1], xyxy[:, 2], xyxy[:, 3]
    return np.stack([(x1 + x2) / 2.0, y2], axis=1)


def project_to_floor(points_xy: np.ndarray, H: np.ndarray) -> np.ndarray:
    """Apply homography H to image points (N,2) -> floor points (N,2)."""
    if len(points_xy) == 0:
        return np.empty((0, 2), dtype=np.float64)
    pts = np.concatenate([points_xy, np.ones((len(points_xy), 1))], axis=1)  # (N,3)
    proj = (H @ pts.T).T  # (N,3)
    w = proj[:, 2:3]
    w[np.abs(w) < 1e-9] = 1e-9
    return proj[:, :2] / w
