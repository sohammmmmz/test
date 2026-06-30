"""Appearance-only cross-camera Re-ID tuner.

This tool answers one question: "Can we match the same person across cam2 and
cam3 using appearance ALONE, with no reliance on the floor-plan calibration?"

It runs the real pipeline (YOLO26 detect -> BoT-SORT track -> OSNet embed) on
two cameras and matches identities across them using ONLY appearance (the same
GlobalIdentityManager as run_poc.py, but with use_geometry=False). The same
person gets the same color/ID in both views.

It also draws the live cam-vs-cam cosine-similarity matrix so you can SEE the
numbers: the same person across cameras should score high (green), different
people low. Use the slider keys to find the threshold where same-person pairs
are green and different-person pairs are not -- then copy that value into
config.yaml as fusion.sim_threshold.

Controls:
    'thr x100' slider   drag to set the match threshold (works even if the
                        window loses focus / key presses get dropped)
    SPACE   play / pause
    a / d   step one frame back / forward (when paused)
    [ / ]   lower / raise the match threshold (also moves the slider)
    r       reset global IDs
    q       quit

Note on the keys: OpenCV only receives key presses while the image window has
focus, and during heavy per-frame inference the capture window is tiny, so key
presses are easily missed. The slider does not have that problem -- use it.

Usage:
    python reid_tuner.py --config config.yaml
"""
from __future__ import annotations

import argparse

import cv2
import numpy as np
import yaml

from src.camera_tracker import CameraTracker
from src.detector import PersonDetector
from src.draw import color_for
from src.fusion import GlobalIdentityManager, Observation
from src.reid_embedder import ReidEmbedder

PANEL_W, PANEL_H = 800, 450


def load_config(path):
    with open(path) as f:
        return yaml.safe_load(f)


def draw_box(frame, xyxy, gid, local_id, best_sim):
    x1, y1, x2, y2 = [int(v) for v in xyxy]
    color = color_for(gid)
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
    label = f"G{gid} L{local_id} s={best_sim:.2f}"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
    cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
    cv2.putText(frame, label, (x1 + 2, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)


def sim_matrix_panel(rows, cols, sims, threshold, width, height):
    """rows/cols: lists of (cam,local_id,gid). sims: 2D array rows x cols."""
    panel = np.full((height, width, 3), 30, np.uint8)
    cv2.putText(panel, "cam-vs-cam cosine similarity (green >= threshold)",
                (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
    x0, y0, cw, ch = 140, 50, 90, 34
    # column headers
    for j, c in enumerate(cols):
        cv2.putText(panel, f"{c[0]}:L{c[1]}", (x0 + j * cw, y0 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 255), 1)
    for i, r in enumerate(rows):
        cv2.putText(panel, f"{r[0]}:L{r[1]}", (8, y0 + i * ch + 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 255, 180), 1)
        for j, c in enumerate(cols):
            s = sims[i, j]
            col = (0, 160, 0) if s >= threshold else (40, 40, 90)
            px, py = x0 + j * cw, y0 + i * ch
            cv2.rectangle(panel, (px, py), (px + cw - 6, py + ch - 6), col, -1)
            cv2.putText(panel, f"{s:.2f}", (px + 8, py + 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return panel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()

    cfg = load_config(args.config)
    device = cfg.get("device", "cuda:0")

    detector = PersonDetector(device=device, **cfg["detector"])
    embedder = ReidEmbedder(weights=cfg["reid"]["weights"], device=device,
                            half=cfg["reid"].get("half", True))

    cam_cfgs = cfg["cameras"][:2]   # this tool compares two cameras
    caps, trackers, names = [], [], []
    for c in cam_cfgs:
        names.append(c["name"])
        caps.append(cv2.VideoCapture(c["video"]))
        tcfg = dict(cfg["tracker"]); tcfg["device"] = device
        trackers.append(CameraTracker(c["name"], tcfg))

    threshold = float(cfg.get("fusion", {}).get("sim_threshold", 0.45))

    def new_manager(th):
        return GlobalIdentityManager(sim_threshold=th, use_geometry=False,
                                     max_age=2.0, min_hits=1)

    fusion = new_manager(threshold)

    win = "reid tuner (appearance only)"
    cv2.namedWindow(win)
    # Threshold slider -- robust to focus/timing issues that drop key presses.
    # Drag it any time; the keys [ and ] also work when the window has focus.
    cv2.createTrackbar("thr x100", win, int(round(threshold * 100)), 95,
                       lambda v: None)
    playing = True
    frame_idx = 0
    last_frames = None

    while True:
        # poll the threshold slider (works even when key presses are missed)
        tb = cv2.getTrackbarPos("thr x100", win) / 100.0
        tb = max(0.05, tb)
        if abs(tb - threshold) > 1e-6:
            threshold = tb
            fusion = new_manager(threshold)

        if playing or last_frames is None:
            frames = []
            ok_all = True
            for cap in caps:
                ok, fr = cap.read()
                if not ok:
                    ok_all = False
                    break
                frames.append(fr)
            if not ok_all:
                playing = False
                if last_frames is None:
                    break
                frames = last_frames
            else:
                last_frames = frames
                frame_idx += 1
        else:
            frames = last_frames

        # detect + track + embed per camera
        per_cam = []  # list per cam of list of dict(local_id, xyxy, emb)
        observations = []
        for ci, fr in enumerate(frames):
            dets = detector.detect(fr)
            tracks = trackers[ci].update(dets, fr)
            items = []
            if len(tracks):
                xyxy = tracks[:, 0:4]
                lids = tracks[:, 4].astype(int)
                embs = embedder(xyxy, fr)
                for k in range(len(tracks)):
                    items.append(dict(local_id=int(lids[k]), xyxy=xyxy[k],
                                      emb=embs[k]))
                    observations.append(Observation(
                        cam=names[ci], local_id=int(lids[k]),
                        floor_xy=np.zeros(2), embedding=embs[k], xyxy=xyxy[k]))
            per_cam.append(items)

        assignment = fusion.update(observations, frame_idx / 30.0)

        # cross-camera similarity matrix (cam0 rows vs cam1 cols)
        rows = [(names[0], it["local_id"],
                 assignment.get((names[0], it["local_id"]))) for it in per_cam[0]]
        cols = [(names[1], it["local_id"],
                 assignment.get((names[1], it["local_id"]))) for it in per_cam[1]]
        sims = np.zeros((len(rows), len(cols)), np.float32)
        for i, a in enumerate(per_cam[0]):
            for j, b in enumerate(per_cam[1]):
                sims[i, j] = float(a["emb"] @ b["emb"])

        # draw camera panels
        panels = []
        for ci, fr in enumerate(frames):
            disp = fr.copy()
            for it in per_cam[ci]:
                gid = assignment.get((names[ci], it["local_id"]), -1)
                # best cross-cam similarity for this detection
                if ci == 0 and len(cols):
                    bi = per_cam[0].index(it)
                    bs = float(sims[bi].max()) if sims.size else 0.0
                elif ci == 1 and len(rows):
                    bj = per_cam[1].index(it)
                    bs = float(sims[:, bj].max()) if sims.size else 0.0
                else:
                    bs = 0.0
                draw_box(disp, it["xyxy"], gid, it["local_id"], bs)
            disp = cv2.resize(disp, (PANEL_W, PANEL_H))
            cv2.rectangle(disp, (0, 0), (PANEL_W, 30), (0, 0, 0), -1)
            cv2.putText(disp, f"{names[ci]}", (10, 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            panels.append(disp)

        cams_row = np.hstack(panels)
        matrix = sim_matrix_panel(rows, cols, sims, threshold,
                                  cams_row.shape[1], 260)
        status = np.full((40, cams_row.shape[1], 3), 20, np.uint8)
        cv2.putText(status,
                    f"threshold={threshold:.2f}  (drag 'thr x100' slider, or [ ])  | "
                    f"{'PLAYING' if playing else 'PAUSED'}  | SPACE a/d r q",
                    (10, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        canvas = np.vstack([cams_row, matrix, status])
        cv2.imshow(win, canvas)

        key = cv2.waitKey(15 if playing else 0) & 0xFF
        if key == ord("q"):
            break
        elif key == ord(" "):
            playing = not playing
        elif key == ord("]"):
            threshold = min(0.95, round(threshold + 0.02, 2))
            cv2.setTrackbarPos("thr x100", win, int(round(threshold * 100)))
            fusion = new_manager(threshold)
        elif key == ord("["):
            threshold = max(0.05, round(threshold - 0.02, 2))
            cv2.setTrackbarPos("thr x100", win, int(round(threshold * 100)))
            fusion = new_manager(threshold)
        elif key == ord("r"):
            fusion = new_manager(threshold)
        elif key in (ord("a"), ord("d")) and not playing:
            # step: advance/rewind by reading; rewind via frame index seek
            step = 1 if key == ord("d") else -1
            target = max(0, frame_idx + step)
            for cap in caps:
                cap.set(cv2.CAP_PROP_POS_FRAMES, target)
            frame_idx = target
            last_frames = None  # force re-read

    for cap in caps:
        cap.release()
    cv2.destroyAllWindows()
    print(f"\nFinal threshold you tuned: {threshold:.2f}")
    print("Copy this into config.yaml -> fusion.sim_threshold")


if __name__ == "__main__":
    main()
