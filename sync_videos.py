"""Interactive multi-camera sync tool.

Shows cam1 / cam2 / cam3 side by side in ONE window on a shared timeline. You
nudge each camera's start until the same real-world moment (a person crossing a
line, a door opening, a clap) lines up in all three panels. Then save -- the
per-camera start offsets are written to configs/sync_offsets.json, which
run_poc.py reads automatically.

How alignment works:
    displayed_frame[cam] = effective_start[cam] + timeline
Offsets are edited as *relative* values (can go negative while you tweak); on
save they are normalized so the earliest camera starts at 0 and the others skip
the right number of frames at the beginning.

Controls:
    SPACE      play / pause
    a / d      timeline  -1 / +1 frame   (when paused)
    z / c      timeline -10 / +10 frames
    1 / 2 / 3  select the active camera (highlighted)
    j / l      active camera start  -1 / +1 frame   (the alignment knob)
    , / .      active camera start -10 / +10 frames
    r          reset active camera offset to 0
    [ / ]      slower / faster playback
    s          save offsets to configs/sync_offsets.json
    q          quit

Usage:
    python sync_videos.py --config config.yaml
    # or point at files directly:
    python sync_videos.py --videos data/cam1.mp4 data/cam2.mp4 data/cam3.mp4
"""
from __future__ import annotations

import argparse
import json
import os

import cv2
import numpy as np
import yaml

PANEL_W, PANEL_H = 640, 360
HELP_LINES = [
    "SPACE play/pause | a/d +-1 | z/c +-10 timeline",
    "1/2/3 pick cam | j/l +-1 | ,/. +-10 start | r reset",
    "[ / ] speed | s save | q quit",
]


def load_videos(args):
    if args.videos:
        paths = args.videos
        names = [f"cam{i+1}" for i in range(len(paths))]
    else:
        with open(args.config) as f:
            cfg = yaml.safe_load(f)
        names = [c["name"] for c in cfg["cameras"]]
        paths = [c["video"] for c in cfg["cameras"]]
    caps, lengths = [], []
    for p in paths:
        cap = cv2.VideoCapture(p)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open {p}")
        caps.append(cap)
        lengths.append(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
    return names, paths, caps, lengths


def get_frame(cap, idx, length):
    if idx < 0 or idx >= length:
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    return frame if ok else None


def make_panel(frame, name, abs_idx, eff_start, active):
    if frame is None:
        panel = np.zeros((PANEL_H, PANEL_W, 3), np.uint8)
        cv2.putText(panel, "no frame", (20, PANEL_H // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
    else:
        panel = cv2.resize(frame, (PANEL_W, PANEL_H))
    # center guide line to help align a crossing event
    cv2.line(panel, (PANEL_W // 2, 0), (PANEL_W // 2, PANEL_H), (60, 60, 60), 1)
    bar = (0, 180, 0) if active else (50, 50, 50)
    cv2.rectangle(panel, (0, 0), (PANEL_W - 1, 28), bar, -1)
    cv2.putText(panel, f"{name}  frame={abs_idx}  start={eff_start}",
                (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    if active:
        cv2.rectangle(panel, (0, 0), (PANEL_W - 1, PANEL_H - 1), (0, 180, 0), 3)
    return panel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--videos", nargs="*", help="explicit video paths")
    ap.add_argument("--out", default="configs/sync_offsets.json")
    args = ap.parse_args()

    names, paths, caps, lengths = load_videos(args)
    n = len(caps)
    offsets = [0] * n          # relative, may go negative while editing
    timeline = 0
    active = 0
    playing = False
    speed = 1                  # frames advanced per tick

    win = "multi-camera sync"
    cv2.namedWindow(win)

    def effective_starts():
        m = min(offsets)
        return [o - m for o in offsets]

    def timeline_max():
        eff = effective_starts()
        return max(1, min(lengths[i] - eff[i] for i in range(n)) - 1)

    cv2.createTrackbar("timeline", win, 0, max(1, timeline_max()),
                       lambda v: None)

    while True:
        eff = effective_starts()
        tmax = timeline_max()
        timeline = max(0, min(timeline, tmax))

        panels = []
        for i in range(n):
            abs_idx = eff[i] + timeline
            frame = get_frame(caps[i], abs_idx, lengths[i])
            panels.append(make_panel(frame, names[i], abs_idx, eff[i], i == active))

        row = np.hstack(panels)
        footer = np.zeros((90, row.shape[1], 3), np.uint8)
        status = (f"timeline {timeline}/{tmax}   active={names[active]}   "
                  f"speed={speed}   {'PLAYING' if playing else 'PAUSED'}")
        cv2.putText(footer, status, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (0, 255, 255), 2)
        for k, line in enumerate(HELP_LINES):
            cv2.putText(footer, line, (10, 44 + k * 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1)
        canvas = np.vstack([row, footer])
        cv2.imshow(win, canvas)
        cv2.setTrackbarPos("timeline", win, timeline)

        key = cv2.waitKey(15 if playing else 0) & 0xFF

        if playing:
            # sync trackbar moves while playing
            timeline += speed
            if timeline >= tmax:
                timeline = tmax
                playing = False

        if key == 0xFF:
            # check if user dragged the trackbar
            tb = cv2.getTrackbarPos("timeline", win)
            if tb != timeline and not playing:
                timeline = tb
            continue
        if key == ord("q"):
            break
        elif key == ord(" "):
            playing = not playing
        elif key in (ord("1"), ord("2"), ord("3")):
            idx = key - ord("1")
            if idx < n:
                active = idx
        elif key == ord("a"):
            timeline -= 1
        elif key == ord("d"):
            timeline += 1
        elif key == ord("z"):
            timeline -= 10
        elif key == ord("c"):
            timeline += 10
        elif key == ord("j"):
            offsets[active] -= 1
        elif key == ord("l"):
            offsets[active] += 1
        elif key == ord(","):
            offsets[active] -= 10
        elif key == ord("."):
            offsets[active] += 10
        elif key == ord("r"):
            offsets[active] = 0
        elif key == ord("["):
            speed = max(1, speed - 1)
        elif key == ord("]"):
            speed = min(30, speed + 1)
        elif key == ord("s"):
            eff = effective_starts()
            out = {names[i]: int(eff[i]) for i in range(n)}
            os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
            with open(args.out, "w") as f:
                json.dump(out, f, indent=2)
            print(f"Saved sync offsets -> {args.out}\n{json.dumps(out, indent=2)}")

    for cap in caps:
        cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
