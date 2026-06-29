"""Person detector wrapper around Ultralytics YOLO.

We keep this thin so the detector model can be swapped (yolo11x / yolo12x / a
custom-finetuned weight) without touching the tracking or fusion code.
"""
from __future__ import annotations

import numpy as np
from ultralytics import YOLO

PERSON_CLASS_ID = 0  # COCO 'person'


class PersonDetector:
    def __init__(self, weights: str, device: str = "cuda:0",
                 conf: float = 0.3, iou: float = 0.5, imgsz: int = 1280,
                 half: bool = True):
        self.model = YOLO(weights)
        self.device = device
        self.conf = conf
        self.iou = iou
        self.imgsz = imgsz
        self.half = half

    def detect(self, frame: np.ndarray) -> np.ndarray:
        """Return detections as an (N, 6) array: [x1, y1, x2, y2, conf, cls]."""
        res = self.model.predict(
            frame,
            classes=[PERSON_CLASS_ID],
            conf=self.conf,
            iou=self.iou,
            imgsz=self.imgsz,
            half=self.half,
            device=self.device,
            verbose=False,
        )[0]

        if res.boxes is None or len(res.boxes) == 0:
            return np.empty((0, 6), dtype=np.float32)

        xyxy = res.boxes.xyxy.cpu().numpy()
        conf = res.boxes.conf.cpu().numpy().reshape(-1, 1)
        cls = res.boxes.cls.cpu().numpy().reshape(-1, 1)
        return np.concatenate([xyxy, conf, cls], axis=1).astype(np.float32)
