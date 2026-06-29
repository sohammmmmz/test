"""Interactive homography calibration: camera view  ->  floor plan.

For each camera you click >= 4 correspondences:
    - click a point on the CAMERA frame (a recognizable spot on the ground)
    - then click the SAME physical spot on the FLOOR PLAN image
Repeat for at least 4 well-spread points (corners of the floor work best).
Press 's' to save, 'u' to undo last point, 'q' to quit.

The saved .npy is the 3x3 matrix that maps camera pixels -> floor-plan pixels.
If your floor plan is to scale (e.g. 1 px = 1 cm), the global fusion distances
are in those same units -- set fusion.max_floor_dist accordingly.

Usage:
    python calibrate_homography.py --camera data/cam1.mp4 \
        --floor data/floorplan.png --out configs/H_cam1.npy
"""
from __future__ import annotations

import argparse

import cv2
import numpy as np


def grab_first_frame(path: str) -> np.ndarray:
    cap = cv2.VideoCapture(path)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError(f"Could not read a frame from {path}")
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", required=True, help="camera video or image")
    ap.add_argument("--floor", required=True, help="floor plan image")
    ap.add_argument("--out", required=True, help="output .npy path")
    args = ap.parse_args()

    cam_img = (grab_first_frame(args.camera)
               if args.camera.lower().endswith((".mp4", ".avi", ".mov", ".mkv"))
               else cv2.imread(args.camera))
    floor_img = cv2.imread(args.floor)

    cam_pts, floor_pts = [], []
    state = {"expect": "cam"}  # alternate cam -> floor

    def redraw():
        a = cam_img.copy()
        for i, p in enumerate(cam_pts):
            cv2.circle(a, p, 6, (0, 255, 0), -1)
            cv2.putText(a, str(i + 1), (p[0] + 6, p[1]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        b = floor_img.copy()
        for i, p in enumerate(floor_pts):
            cv2.circle(b, p, 6, (0, 0, 255), -1)
            cv2.putText(b, str(i + 1), (p[0] + 6, p[1]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        cv2.imshow("camera (click ground points)", a)
        cv2.imshow("floor plan (click same spots)", b)

    def on_cam(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and state["expect"] == "cam":
            cam_pts.append((x, y)); state["expect"] = "floor"; redraw()

    def on_floor(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and state["expect"] == "floor":
            floor_pts.append((x, y)); state["expect"] = "cam"; redraw()

    cv2.namedWindow("camera (click ground points)")
    cv2.namedWindow("floor plan (click same spots)")
    cv2.setMouseCallback("camera (click ground points)", on_cam)
    cv2.setMouseCallback("floor plan (click same spots)", on_floor)
    redraw()

    print("Click >=4 correspondences (camera then floor). s=save u=undo q=quit")
    while True:
        key = cv2.waitKey(20) & 0xFF
        if key == ord("q"):
            break
        if key == ord("u"):
            if state["expect"] == "floor" and cam_pts:
                cam_pts.pop()
            elif floor_pts:
                floor_pts.pop()
            state["expect"] = "cam" if len(cam_pts) == len(floor_pts) else "floor"
            redraw()
        if key == ord("s"):
            n = min(len(cam_pts), len(floor_pts))
            if n < 4:
                print(f"Need >=4 pairs, have {n}.")
                continue
            H, mask = cv2.findHomography(
                np.array(cam_pts[:n], dtype=np.float64),
                np.array(floor_pts[:n], dtype=np.float64),
                cv2.RANSAC, 5.0)
            np.save(args.out, H)
            print(f"Saved homography to {args.out}\n{H}")
            print(f"Inliers: {int(mask.sum())}/{n}")
            break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
