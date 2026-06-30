"""Multi-camera person tracking & unique-count POC.

Pipeline per synchronized frame index:
    for each camera:
        YOLO detect persons
        BoxMOT tracker -> stable local ids
        Re-ID embed each track crop
        project foot point -> floor coordinates (homography)
    -> hand all observations to the GlobalIdentityManager
    -> it returns a consistent GLOBAL id per (camera, local id)
    -> count distinct global ids = people on the floor

Because the three videos share timestamps, we align them by frame index. If
your videos have different FPS or start offsets, set per-camera 'start_frame'
and a common 'fps' in config and the loader will align by time.

Usage:
    python run_poc.py --config config.yaml
"""
from __future__ import annotations

import argparse
import json
import os
import time

import cv2
import numpy as np
import yaml

from src.camera_tracker import CameraTracker
from src.detector import PersonDetector
from src.draw import draw_box, draw_count, draw_floor
from src.fusion import GlobalIdentityManager, Observation
from src.geometry import foot_point, load_homography, project_to_floor
from src.reid_embedder import ReidEmbedder


def load_config(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--show", action="store_true", help="show live windows")
    ap.add_argument("--save", default="", help="optional output mp4 path (tiled)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    device = cfg.get("device", "cuda:0")
    fps = float(cfg.get("fps", 15))

    # --- shared models (one detector + one reid model for all cameras) ---
    detector = PersonDetector(device=device, **cfg["detector"])
    embedder = ReidEmbedder(weights=cfg["reid"]["weights"], device=device,
                            half=cfg["reid"].get("half", True))

    # --- sync offsets from sync_videos.py override config start_frame ---
    sync_path = cfg.get("sync_offsets", "configs/sync_offsets.json")
    sync_offsets = {}
    if sync_path and os.path.exists(sync_path):
        with open(sync_path) as f:
            sync_offsets = json.load(f)
        print(f"Loaded sync offsets from {sync_path}: {sync_offsets}")

    # --- per-camera state ---
    cams = []
    for c in cfg["cameras"]:
        tcfg = dict(cfg["tracker"]); tcfg["device"] = device
        start_frame = int(sync_offsets.get(c["name"], c.get("start_frame", 0)))
        cams.append({
            "name": c["name"],
            "cap": cv2.VideoCapture(c["video"]),
            "H": load_homography(c["homography"]),
            "tracker": CameraTracker(c["name"], tcfg),
            "start_frame": start_frame,
        })
        # seek to start offset for time alignment
        for _ in range(cams[-1]["start_frame"]):
            cams[-1]["cap"].read()

    # --- build fusion: geometry thresholds are given in METERS and converted to
    #     floor-plan pixels using the plan's measured scale (px per metre) ---
    fcfg = dict(cfg.get("fusion", {}))
    px_per_m = float(cfg.get("floor_px_per_meter", 115.5))
    if "max_floor_dist_m" in fcfg:
        fcfg["max_floor_dist"] = fcfg.pop("max_floor_dist_m") * px_per_m
    fusion = GlobalIdentityManager(**fcfg)

    floor_img = None
    if cfg.get("floor_plan"):
        floor_img = cv2.imread(cfg["floor_plan"])
    floor_scale = float(cfg.get("floor_scale", 1.0))

    writer = None
    frame_idx = 0
    t0 = time.time()

    while True:
        frames = {}
        ok_all = True
        for cam in cams:
            ok, frame = cam["cap"].read()
            if not ok:
                ok_all = False
                break
            frames[cam["name"]] = frame
        if not ok_all:
            break

        t = frame_idx / fps
        observations: list[Observation] = []

        for cam in cams:
            frame = frames[cam["name"]]
            dets = detector.detect(frame)
            tracks = cam["tracker"].update(dets, frame)  # (M,8)
            if len(tracks) == 0:
                continue

            xyxy = tracks[:, 0:4]
            local_ids = tracks[:, 4].astype(int)
            embs = embedder(xyxy, frame)                       # (M,D)
            floor = project_to_floor(foot_point(xyxy), cam["H"])  # (M,2)

            for k in range(len(tracks)):
                observations.append(Observation(
                    cam=cam["name"],
                    local_id=int(local_ids[k]),
                    floor_xy=floor[k],
                    embedding=embs[k],
                    xyxy=xyxy[k],
                ))

        assignment = fusion.update(observations, t)

        # --- draw ---
        on_floor = fusion.active_count(t)
        total = fusion.total_unique()
        floor_positions = {}
        panels = []
        for cam in cams:
            frame = frames[cam["name"]]
            for obs in observations:
                if obs.cam != cam["name"]:
                    continue
                gid = assignment.get((obs.cam, obs.local_id))
                if gid is None:
                    continue
                draw_box(frame, obs.xyxy, gid, label_extra=f"L{obs.local_id}")
                floor_positions[gid] = obs.floor_xy
            draw_count(frame, on_floor, total)
            panels.append(cv2.resize(frame, (960, 540)))

        if args.show or args.save:
            tiled = np.hstack(panels) if len(panels) <= 2 else \
                np.vstack([np.hstack(panels[:2]),
                           np.hstack(panels[2:] + [np.zeros_like(panels[0])][:2 - len(panels[2:])])])
            if floor_img is not None:
                fmap = draw_floor(floor_img, floor_positions, floor_scale)
                fmap = cv2.resize(fmap, (tiled.shape[1] // 3, tiled.shape[1] // 3 * fmap.shape[0] // fmap.shape[1]))
            if args.show:
                cv2.imshow("cameras", tiled)
                if floor_img is not None:
                    cv2.imshow("floor", fmap)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            if args.save:
                if writer is None:
                    h, w = tiled.shape[:2]
                    writer = cv2.VideoWriter(args.save,
                                             cv2.VideoWriter_fourcc(*"mp4v"),
                                             fps, (w, h))
                writer.write(tiled)

        if frame_idx % 30 == 0:
            elapsed = time.time() - t0
            print(f"frame {frame_idx:5d} | on_floor={on_floor} unique={total} "
                  f"| {frame_idx / max(elapsed, 1e-6):.1f} fps")
        frame_idx += 1

    for cam in cams:
        cam["cap"].release()
    if writer:
        writer.release()
    cv2.destroyAllWindows()
    print(f"\nDONE. Total unique people seen: {fusion.total_unique()}")


if __name__ == "__main__":
    main()
