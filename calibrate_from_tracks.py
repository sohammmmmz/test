"""Accurate cross-camera calibration from a walking person.

Manual floor-corner clicking has a huge error margin. Instead, this tool builds
the cam->cam ground-plane homography from the FEET of people you mark:

  1. Click the same person in the cam2 panel and in the cam3 panel to PAIR them.
  2. As the videos play, the tool auto-tracks both and records the pair of foot
     points (bottom-centre of each box) every time the person moves a bit.
  3. Walk the person around the overlap area (and pair a few different people)
     to spread points across the floor.
  4. Press 'f' to fit the homography (RANSAC discards occluded-foot frames) and
     see the reprojection error + a live overlay of cam2 feet projected into
     cam3. Press 's' to save.

Output (reference frame = the SECOND camera, cam3):
    configs/H_<cam2>.npy = homography cam2 -> cam3
    configs/H_<cam3>.npy = identity (cam3 is the reference)
Set `geometry_reference: camera` in config.yaml to use these.

Why feet: a walking person's feet lie on the ground plane, so a single planar
homography between the two views is exactly valid. ~15+ spread correspondences
give a good fit; a walk gives hundreds.

Controls:
    click cam2 then cam3   pair the same person (arms collection)
    SPACE   play / pause
    c       toggle auto-collection on/off (on by default once a pair is armed)
    x       clear the current armed pair (keep collected points)
    u       undo the last collected point
    f       fit homography from collected points (RANSAC) + show error
    s       save homographies to configs/
    q       quit

Usage:
    python calibrate_from_tracks.py --config config.yaml
"""
from __future__ import annotations

import argparse
import os

import cv2
import numpy as np
import yaml

from src.camera_tracker import CameraTracker
from src.detector import PersonDetector

PANEL_W, PANEL_H = 800, 450
MIN_SPREAD_PX = 12      # only record a new point once the foot has moved this far
MIN_POINTS = 8          # absolute minimum to fit a homography
GOOD_POINTS = 15        # recommended minimum for a reliable fit


def load_config(path):
    with open(path) as f:
        return yaml.safe_load(f)


def foot_of(xyxy):
    x1, y1, x2, y2 = xyxy
    return np.array([(x1 + x2) / 2.0, y2], dtype=np.float64)


def track_under(tracks, pt):
    """Return local_id of the smallest track box containing pt, else None."""
    best, best_area = None, 1e18
    for tr in tracks:
        x1, y1, x2, y2, tid = tr[0], tr[1], tr[2], tr[3], int(tr[4])
        if x1 <= pt[0] <= x2 and y1 <= pt[1] <= y2:
            area = (x2 - x1) * (y2 - y1)
            if area < best_area:
                best, best_area = tid, area
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()
    cfg = load_config(args.config)
    device = cfg.get("device", "cuda:0")

    detector = PersonDetector(device=device, **cfg["detector"])
    cam_cfgs = cfg["cameras"][:2]
    names = [c["name"] for c in cam_cfgs]
    caps, trackers = [], []
    for c in cam_cfgs:
        caps.append(cv2.VideoCapture(c["video"]))
        tcfg = dict(cfg["tracker"]); tcfg["device"] = device
        trackers.append(CameraTracker(c["name"], tcfg))

    pts_a, pts_b = [], []            # collected correspondences (cam0 foot, cam1 foot)
    armed = [None, None]             # armed local ids per camera
    last_recorded = [None, None]
    H = None
    playing = True
    collecting = True

    win = "track-based calibration"
    cv2.namedWindow(win)

    scale = [1.0, 1.0]   # original/panel scale per cam, set after first read
    click = {"pos": None}

    def on_mouse(event, x, y, flags, param):
        if event != cv2.EVENT_LBUTTONDOWN:
            return
        ci = 0 if x < PANEL_W else 1
        ox = (x - ci * PANEL_W) * scale[ci]
        oy = y * scale[ci]
        click["pos"] = (ci, np.array([ox, oy]))

    cv2.setMouseCallback(win, on_mouse)

    def fit():
        nonlocal H
        if len(pts_a) < MIN_POINTS:
            print(f"Need >= {MIN_POINTS} points, have {len(pts_a)}.")
            return
        a = np.array(pts_a); b = np.array(pts_b)
        H, mask = cv2.findHomography(a, b, cv2.RANSAC, 5.0)
        if H is None:
            print("Homography fit failed (points may be collinear). Walk more area.")
            return
        inl = mask.ravel().astype(bool)
        proj = cv2.perspectiveTransform(a[inl].reshape(-1, 1, 2), H).reshape(-1, 2)
        err = float(np.mean(np.linalg.norm(proj - b[inl], axis=1)))
        print(f"Fitted H from {len(pts_a)} pts | inliers {int(inl.sum())} | "
              f"mean reproj error {err:.1f} px in {names[1]} space"
              f"{'  (collect more / wider for <3px)' if err > 3 else '  (good)'}")

    while True:
        if playing:
            frames, ok_all = [], True
            for cap in caps:
                ok, fr = cap.read()
                if not ok:
                    ok_all = False; break
                frames.append(fr)
            if not ok_all:
                playing = False
                continue
            cur_frames = frames
        # detect + track both cams
        tracks_per = []
        for ci, fr in enumerate(cur_frames):
            scale[ci] = fr.shape[1] / PANEL_W
            dets = detector.detect(fr)
            tr = trackers[ci].update(dets, fr)
            tracks_per.append(tr if len(tr) else np.empty((0, 8)))

        # handle a click -> arm the track under it
        if click["pos"] is not None:
            ci, p = click["pos"]; click["pos"] = None
            tid = track_under(tracks_per[ci], p)
            if tid is not None:
                armed[ci] = tid
                print(f"armed {names[ci]} id={tid}")

        # auto-collect a correspondence when both armed ids are visible
        if collecting and armed[0] is not None and armed[1] is not None:
            box = [None, None]
            for ci in range(2):
                for tr in tracks_per[ci]:
                    if int(tr[4]) == armed[ci]:
                        box[ci] = tr[0:4]; break
            if box[0] is not None and box[1] is not None:
                fa, fb = foot_of(box[0]), foot_of(box[1])
                if (last_recorded[0] is None or
                        np.linalg.norm(fa - last_recorded[0]) > MIN_SPREAD_PX):
                    pts_a.append(fa); pts_b.append(fb)
                    last_recorded = [fa, fb]

        # draw
        panels = []
        for ci, fr in enumerate(cur_frames):
            disp = cv2.resize(fr, (PANEL_W, PANEL_H))
            sx = PANEL_W / fr.shape[1]; sy = PANEL_H / fr.shape[0]
            for tr in tracks_per[ci]:
                x1, y1, x2, y2 = (tr[0:4] * [sx, sy, sx, sy]).astype(int)
                tid = int(tr[4])
                is_armed = (tid == armed[ci])
                col = (0, 220, 0) if is_armed else (180, 180, 180)
                cv2.rectangle(disp, (x1, y1), (x2, y2), col, 2 if is_armed else 1)
                cv2.circle(disp, (int((x1 + x2) / 2), y2), 4, (0, 0, 255), -1)
                cv2.putText(disp, f"{tid}", (x1, y1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 1)
            # collected points for this cam
            pts = pts_a if ci == 0 else pts_b
            for p in pts:
                cv2.circle(disp, (int(p[0] * sx), int(p[1] * sy)), 2, (255, 200, 0), -1)
            cv2.rectangle(disp, (0, 0), (PANEL_W, 28), (0, 0, 0), -1)
            cv2.putText(disp, f"{names[ci]}  armed={armed[ci]}", (8, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            panels.append((disp, sx, sy))

        # overlay: project cam0 feet into cam1 via current H (quality check)
        if H is not None and len(pts_a):
            a = np.array(pts_a).reshape(-1, 1, 2)
            proj = cv2.perspectiveTransform(a, H).reshape(-1, 2)
            d1, sx1, sy1 = panels[1]
            for q in proj:
                cv2.circle(d1, (int(q[0] * sx1), int(q[1] * sy1)), 3, (0, 0, 255), 1)

        row = np.hstack([p[0] for p in panels])
        bar = np.full((46, row.shape[1], 3), 20, np.uint8)
        msg = (f"points={len(pts_a)} (need>={GOOD_POINTS})  "
               f"collecting={'ON' if collecting else 'OFF'}  "
               f"H={'fitted' if H is not None else 'none'}  "
               f"{'PLAYING' if playing else 'PAUSED'}  | "
               f"click pair | SPACE c x u f s q")
        cv2.putText(bar, msg, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    (0, 255, 0), 2)
        cv2.imshow(win, np.vstack([row, bar]))

        key = cv2.waitKey(15 if playing else 0) & 0xFF
        if key == ord("q"):
            break
        elif key == ord(" "):
            playing = not playing
        elif key == ord("c"):
            collecting = not collecting
        elif key == ord("x"):
            armed = [None, None]; last_recorded = [None, None]
        elif key == ord("u") and pts_a:
            pts_a.pop(); pts_b.pop(); last_recorded = [None, None]
        elif key == ord("f"):
            fit()
        elif key == ord("s"):
            if H is None:
                fit()
            if H is not None:
                os.makedirs("configs", exist_ok=True)
                pa = cam_cfgs[0]["homography"]; pb = cam_cfgs[1]["homography"]
                np.save(pa, H)
                np.save(pb, np.eye(3))
                print(f"Saved {pa} (= {names[0]}->{names[1]}) and {pb} (identity).")
                print("Set geometry_reference: camera in config.yaml to use these.")

    for cap in caps:
        cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
