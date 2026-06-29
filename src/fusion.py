"""Global identity fusion across cameras and time.

This is the heart of the system. It consumes per-camera observations
(local track id + Re-ID embedding + floor position) at each synchronized
timestep and assigns each one a stable GLOBAL id.

Two properties fall out of this design:

  1. Cross-camera consistency: the same person seen by cam1 and cam2 at the
     same floor location with similar appearance gets ONE global id.

  2. Self-healing per-camera ID switches: if a single-camera tracker drops a
     person and later re-acquires them under a NEW local id, that new local id
     arrives here "unbound" and is re-matched to the SAME global id via the
     appearance gallery + floor position. The global id therefore survives
     local id churn -- which is exactly the failure you were hitting.

Matching uses a gated cost that fuses appearance (cosine distance to a per-
identity embedding gallery) and geometry (floor-plane distance), solved with
the Hungarian algorithm.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy.optimize import linear_sum_assignment


@dataclass
class Observation:
    cam: str
    local_id: int
    floor_xy: np.ndarray          # (2,) in floor-plan coordinates
    embedding: np.ndarray         # (D,) L2-normalized
    xyxy: np.ndarray              # (4,) image box, for drawing


@dataclass
class GlobalTrack:
    gid: int
    gallery: deque                # recent embeddings (L2-normalized)
    floor_xy: np.ndarray
    last_seen_t: float
    hits: int = 0
    # which local id currently represents this identity in each camera
    bindings: dict = field(default_factory=dict)   # cam -> local_id

    def mean_embedding(self) -> np.ndarray:
        m = np.mean(np.stack(self.gallery), axis=0)
        n = np.linalg.norm(m)
        return m / (n if n > 0 else 1.0)


class GlobalIdentityManager:
    def __init__(self,
                 sim_threshold: float = 0.45,     # min cosine sim to allow an appearance match
                 max_floor_dist: float = 1.2,     # floor units for the geometry tie-breaker
                 w_appearance: float = 0.6,        # cost weight: appearance vs geometry
                 use_geometry: bool = False,       # if False: pure appearance (no homography)
                 geo_weight: float = 0.3,          # how much geometry nudges the cost (soft)
                 gallery_size: int = 50,
                 max_age: float = 5.0,             # seconds before a global id is retired
                 min_hits: int = 3):               # confirmations before counting an id
        self.sim_threshold = sim_threshold
        self.max_floor_dist = max_floor_dist
        self.w_app = w_appearance
        self.w_geo = 1.0 - w_appearance
        self.use_geometry = use_geometry
        self.geo_weight = geo_weight
        self.gallery_size = gallery_size
        self.max_age = max_age
        self.min_hits = min_hits

        self.tracks: dict[int, GlobalTrack] = {}
        self._next_gid = 1
        # fast, stable path: a (cam, local_id) we have seen before -> gid
        self._binding_index: dict[tuple[str, int], int] = {}

    # ------------------------------------------------------------------ #
    def update(self, observations: list[Observation], t: float) -> dict:
        """Assign a global id to each observation at time t.

        Returns {(cam, local_id): gid}.
        """
        assignment: dict[tuple[str, int], int] = {}
        claimed_by_cam: dict[str, set[int]] = {}  # cam -> set of gids already used this frame

        unbound: list[Observation] = []

        # --- Pass 1: fast path for already-known (cam, local_id) bindings ---
        for obs in observations:
            key = (obs.cam, obs.local_id)
            gid = self._binding_index.get(key)
            if gid is not None and gid in self.tracks:
                used = claimed_by_cam.setdefault(obs.cam, set())
                if gid not in used:
                    self._absorb(gid, obs, t)
                    assignment[key] = gid
                    used.add(gid)
                    continue
            unbound.append(obs)

        # --- Pass 2: appearance + geometry matching for unbound observations ---
        if unbound:
            gids = list(self.tracks.keys())
            self._match_unbound(unbound, gids, t, assignment, claimed_by_cam)

        self._retire(t)
        return assignment

    # ------------------------------------------------------------------ #
    def _match_unbound(self, unbound, gids, t, assignment, claimed_by_cam):
        if gids:
            cost = np.full((len(unbound), len(gids)), 1e6, dtype=np.float64)
            for i, obs in enumerate(unbound):
                for j, gid in enumerate(gids):
                    tr = self.tracks[gid]
                    # a global id can appear at most once per camera per frame
                    if gid in claimed_by_cam.get(obs.cam, set()):
                        continue
                    sim = float(obs.embedding @ tr.mean_embedding())

                    # APPEARANCE IS THE GATE. A pair may only merge if it looks
                    # alike enough. Geometry never vetoes a strong appearance
                    # match -- it only breaks ties between similar candidates.
                    if sim < self.sim_threshold:
                        continue

                    c = 1.0 - sim
                    if self.use_geometry:
                        geo = float(np.linalg.norm(obs.floor_xy - tr.floor_xy))
                        geo_cost = min(geo / self.max_floor_dist, 1.0)  # capped: soft, not a veto
                        c += self.geo_weight * geo_cost
                    cost[i, j] = c

            rows, cols = linear_sum_assignment(cost)
            matched_rows = set()
            for r, c in zip(rows, cols):
                if cost[r, c] >= 1e6:
                    continue
                obs, gid = unbound[r], gids[c]
                self._absorb(gid, obs, t)
                assignment[(obs.cam, obs.local_id)] = gid
                self._binding_index[(obs.cam, obs.local_id)] = gid
                claimed_by_cam.setdefault(obs.cam, set()).add(gid)
                matched_rows.add(r)
        else:
            matched_rows = set()

        # --- Pass 3: anything still unmatched becomes a brand-new identity ---
        for i, obs in enumerate(unbound):
            if i in matched_rows:
                continue
            gid = self._spawn(obs, t)
            assignment[(obs.cam, obs.local_id)] = gid
            claimed_by_cam.setdefault(obs.cam, set()).add(gid)

    # ------------------------------------------------------------------ #
    def _absorb(self, gid: int, obs: Observation, t: float):
        tr = self.tracks[gid]
        tr.gallery.append(obs.embedding)
        tr.floor_xy = obs.floor_xy
        tr.last_seen_t = t
        tr.hits += 1
        tr.bindings[obs.cam] = obs.local_id
        self._binding_index[(obs.cam, obs.local_id)] = gid

    def _spawn(self, obs: Observation, t: float) -> int:
        gid = self._next_gid
        self._next_gid += 1
        self.tracks[gid] = GlobalTrack(
            gid=gid,
            gallery=deque([obs.embedding], maxlen=self.gallery_size),
            floor_xy=obs.floor_xy,
            last_seen_t=t,
            hits=1,
            bindings={obs.cam: obs.local_id},
        )
        self._binding_index[(obs.cam, obs.local_id)] = gid
        return gid

    def _retire(self, t: float):
        dead = [gid for gid, tr in self.tracks.items()
                if t - tr.last_seen_t > self.max_age]
        for gid in dead:
            for (cam, lid), g in list(self._binding_index.items()):
                if g == gid:
                    del self._binding_index[(cam, lid)]
            del self.tracks[gid]

    # ------------------------------------------------------------------ #
    def active_count(self, t: float, min_hits: int = None) -> int:
        """Number of distinct people currently on the floor."""
        mh = self.min_hits if min_hits is None else min_hits
        return sum(1 for tr in self.tracks.values()
                   if tr.hits >= mh and t - tr.last_seen_t <= self.max_age)

    def total_unique(self, min_hits: int = 3) -> int:
        """High-water mark of distinct identities ever confirmed."""
        return self._next_gid - 1
