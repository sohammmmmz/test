# Multi-Camera Person Tracking & Unique-Count POC

Track and count people across **3 overlapping cameras** with a **single,
consistent ID per person** — both across cameras and across time within one
camera. Built for a Windows PC with an **RTX 5090 (32 GB RAM)**.

## Why this fixes your ID-switching problem

Your symptom: a single-camera tracker drops a person mid-stream and gives them a
**new ID** when it re-detects them.

This system uses **two layers**:

1. **Per-camera tracker (BoT-SORT + CLIP-ReID)** with a long `track_buffer`, so
   short occlusions/missed detections don't kill the track in the first place.
2. **A global identity layer** (`src/fusion.py`) that keys every person on a
   **Re-ID appearance gallery + floor-plan position**. When the local tracker
   *does* switch an ID, the new local ID arrives "unbound" and is re-matched to
   the **same global ID** by appearance + map location. The global ID survives
   local churn — and the **same mechanism** gives one ID across all 3 cameras.

So per-stream ID switches become *self-healing*, and cross-camera identity is
free from the same machinery.

## Tech stack (latest, mid-2026)

| Stage | Choice | Why |
|---|---|---|
| Detector | **YOLO26x** via Ultralytics (latest, Sept 2025) | NMS-free end-to-end => cleaner boxes for the tracker; better small-object accuracy |
| Per-camera tracker | **BoT-SORT** w/ ReID (BoostTrack / Deep OC-SORT swappable) | appearance + motion + camera-motion compensation; strong on ID switches |
| Re-ID embeddings | **CLIP-ReID** (`clip_market1501.pt`) | SOTA-class appearance features; ~95% R1 on Market-1501 |
| Cross-camera fusion | custom Hungarian matcher (appearance + ground-plane geometry) | one global ID per person |
| Geometry | per-camera homography to your floor plan | overlapping views become a strength, not duplication |

All trackers/ReID weights come from **BoxMOT**, so you can A/B trackers by
changing one line in `config.yaml`.

## Setup (Windows + RTX 5090)

The 5090 is Blackwell (`sm_120`) and needs **CUDA 12.9 PyTorch wheels** — stock
wheels fail with *"no kernel image is available for execution on the device."*
(You have CUDA 12.9, so use the `cu129` index. `cu128` also works since the
wheel ships its own CUDA runtime.)

```powershell
python -m venv .venv
.\.venv\Scripts\activate

# STEP 1: PyTorch built for Blackwell (do this first, on its own)
`pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu129`

# STEP 2: everything else
pip install -r requirements.txt

# YOLO26 needs a recent Ultralytics; ensure you're current
pip install -U ultralytics

# sanity check -- must print True and your GPU name
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## Workflow

1. **Drop your data in `data/`**: `cam1.mp4`, `cam2.mp4`, `cam3.mp4`, and your
   `floorplan.png`.

2. **Sync the three videos** (handles frame-start delays between cameras):
   ```powershell
   python sync_videos.py --config config.yaml
   ```
   The three cameras play in one window on a shared timeline. Find a moment
   visible in all three (a person crossing a spot, a door, a clap), then select
   each camera (`1`/`2`/`3`) and nudge its start with `j`/`l` (±1) and `,`/`.`
   (±10) until that moment lines up in every panel. Press `s` to save. Offsets
   go to `configs/sync_offsets.json` and `run_poc.py` picks them up
   automatically. (Full controls are printed in the window footer.)

3. **Calibrate each camera to the floor plan** (once per camera):
   ```powershell
   python calibrate_homography.py --camera data/cam1.mp4 --floor data/floorplan.png --out configs/H_cam1.npy
   python calibrate_homography.py --camera data/cam2.mp4 --floor data/floorplan.png --out configs/H_cam2.npy
   python calibrate_homography.py --camera data/cam3.mp4 --floor data/floorplan.png --out configs/H_cam3.npy
   ```
   Click **≥4 ground points** that you can identify in both the camera and the
   floor plan (floor corners, pillar bases, floor markings). Spread them out.
   `s` saves, `u` undoes, `q` quits.

4. **Set `fusion.max_floor_dist`** to your floor-plan units. If 1 floor-plan
   pixel ≈ 1 cm, a value of ~120 means "120 cm" gating. If your plan is metric,
   use meters. This controls how close two detections must be to be considered
   the same person.

5. **Run:**
   ```powershell
   python run_poc.py --config config.yaml --show           # live windows
   python run_poc.py --config config.yaml --save out.mp4    # render to file
   ```
   You get per-camera boxes labeled `ID <global>` (`L<local>` shows the raw
   local id so you can *watch* the self-healing), a live **On floor / Unique
   seen** counter, and a top-down floor map with dots per person.

## Tuning cheatsheet

| Problem | Change |
|---|---|
| Person gets a new ID after walking behind something | ↑ `tracker.track_buffer`, ↑ `fusion.max_age` |
| Two different people merged into one ID | ↑ `fusion.sim_threshold`, ↓ `fusion.max_floor_dist` |
| Same person split into two global IDs | ↓ `fusion.sim_threshold`, ↑ `fusion.max_floor_dist`, ↑ `gallery_size` |
| Distant/small people missed | ↑ `detector.imgsz` (1536), ↓ `detector.conf` |
| Too slow | ↓ `detector.imgsz`, use `yolo26l.pt`/`yolo26m.pt`, tracker `deepocsort` |

## Files

```
run_poc.py               main pipeline (detect -> track -> embed -> fuse -> count)
sync_videos.py           interactive 3-camera frame-sync (writes sync_offsets.json)
calibrate_homography.py  interactive camera->floor calibration
config.yaml              all knobs
src/detector.py          YOLO person detector
src/camera_tracker.py    BoxMOT per-camera tracker (local ids)
src/reid_embedder.py     CLIP-ReID embedding extractor
src/geometry.py          homography / floor projection
src/fusion.py            global identity manager  <-- the core
src/draw.py              visualization
```
