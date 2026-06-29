"""Visualization helpers: draw global ids on camera frames and on the floor map."""
from __future__ import annotations

import cv2
import numpy as np


def color_for(gid: int) -> tuple[int, int, int]:
    rng = np.random.RandomState(gid * 9973 % 2**31)
    return tuple(int(c) for c in rng.randint(64, 256, size=3))


def draw_box(frame, xyxy, gid: int, label_extra: str = ""):
    x1, y1, x2, y2 = [int(v) for v in xyxy]
    color = color_for(gid)
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    label = f"ID {gid}{(' ' + label_extra) if label_extra else ''}"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
    cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
    cv2.putText(frame, label, (x1 + 2, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)


def draw_count(frame, count: int, total: int):
    txt = f"On floor: {count}   |   Unique seen: {total}"
    cv2.rectangle(frame, (0, 0), (520, 40), (0, 0, 0), -1)
    cv2.putText(frame, txt, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                (0, 255, 0), 2)


def draw_floor(floor_img, positions: dict, scale: float, origin=(0, 0)):
    """positions: {gid: (fx, fy)} in floor-plan units. Draw dots on a copy."""
    canvas = floor_img.copy()
    for gid, (fx, fy) in positions.items():
        px = int(origin[0] + fx * scale)
        py = int(origin[1] + fy * scale)
        cv2.circle(canvas, (px, py), 8, color_for(gid), -1)
        cv2.putText(canvas, str(gid), (px + 8, py),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_for(gid), 2)
    return canvas
