"""
Floor Plan Generator
Scale: 1 pixel = 0.01 m  (100 px/m)
At 150 DPI output: 1 cm = 1.5 px → effective drawing scale ~1:67
Canvas: proportional to 9.834 m × 8.83 m room + margins
"""

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyArrowPatch
import matplotlib.patheffects as pe
import numpy as np

# ── Dimensions (all in metres) ────────────────────────────────────────────────
ROOM_W = 9.834
ROOM_H = 8.830

# Margins around the room for dimension callouts
ML, MR, MT, MB = 2.0, 1.8, 1.5, 2.0

FIG_W = ML + ROOM_W + MR
FIG_H = MB + ROOM_H + MT

# Origin of room (bottom-left corner) in figure space
OX = ML
OY = MB

# ── Setup ─────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(FIG_W, FIG_H), dpi=150)
fig.patch.set_facecolor('#FDFDFC')
ax.set_facecolor('#FDFDFC')
ax.set_xlim(0, FIG_W)
ax.set_ylim(0, FIG_H)
ax.set_aspect('equal')
ax.axis('off')

# ── Helper: figure coords from room coords ────────────────────────────────────
# Room coords: x right from left wall, y DOWN from top wall
def rx(x): return OX + x
def ry(y): return OY + ROOM_H - y   # y is depth from TOP wall


# ── Room floor fill ───────────────────────────────────────────────────────────
room_bg = patches.Rectangle((OX, OY), ROOM_W, ROOM_H,
                             lw=0, facecolor='#EEF0E8', zorder=1)
ax.add_patch(room_bg)

# ── Room walls (thick border) ────────────────────────────────────────────────
room_wall = patches.Rectangle((OX, OY), ROOM_W, ROOM_H,
                               lw=4, edgecolor='#1A1A2E', facecolor='none', zorder=4)
ax.add_patch(room_wall)


# ── Fixture drawing ──────────────────────────────────────────────────────────
def fixture(x, y_top, w, h, hatch='////', color='#C0C0BB', label=None):
    """
    x, y_top : room coords. x from left wall; y_top is depth from top wall.
    w : width (x-direction);  h : height (into room, y-direction)
    """
    rect = patches.Rectangle(
        (rx(x), ry(y_top + h)), w, h,
        lw=1.5, edgecolor='#1A1A2E', facecolor=color,
        hatch=hatch, zorder=3
    )
    ax.add_patch(rect)
    if label:
        cx = rx(x) + w / 2
        cy = ry(y_top + h) + h / 2
        ax.text(cx, cy, label, ha='center', va='center',
                fontsize=6.5, color='#1A1A2E', fontweight='bold',
                zorder=5, wrap=True)


# ── ELEMENT A: top-left counter / bench  (1.67 m wide, ~0.30 m deep) ─────────
EA_x, EA_yt, EA_w, EA_h = 0, 0, 1.67, 0.30
fixture(EA_x, EA_yt, EA_w, EA_h, label='Counter')

# ── ELEMENT B: centre pillar / unit  (0.914 m × 0.914 m) ────────────────────
EB_x = EA_w + 1.21
EB_yt, EB_w, EB_h = 0, 0.914, 0.914
fixture(EB_x, EB_yt, EB_w, EB_h, label='Unit')

# ── TOP-RIGHT COMPLEX (flush top-right corner) ────────────────────────────────
# Main block: 2.6 m wide × 2.6 m deep
TR_x = ROOM_W - 2.6
TR_yt, TR_w, TR_h = 0, 2.6, 2.6
fixture(TR_x, TR_yt, TR_w, TR_h, label='Main\nBlock')

# Lower-right element: 0.62 m wide × 0.73 m deep (continues below main block)
LR_x = ROOM_W - 0.62
LR_yt = TR_h           # starts right below main block
LR_w, LR_h = 0.62, 0.73
fixture(LR_x, LR_yt, LR_w, LR_h)

# Bottom element: 0.58 m wide × 0.55 m deep (estimated height, below lower-right)
BOT_x = ROOM_W - 0.58
BOT_yt = TR_h + LR_h
BOT_w, BOT_h = 0.58, 0.55
fixture(BOT_x, BOT_yt, BOT_w, BOT_h)


# ── Dimension annotation helpers ─────────────────────────────────────────────
DIM_C  = '#1833AA'       # dimension line colour
DIM_FS = 7.0             # font size

def dim_h(x1_r, x2_r, y_fig, label, gap=0.22, above=True):
    """Horizontal dim between two room x-coords, at a given figure y."""
    f1 = rx(x1_r)
    f2 = rx(x2_r)
    mid = (f1 + f2) / 2
    dy = gap if above else -gap
    ay = y_fig + dy
    # Arrow
    ax.annotate('', xy=(f2, ay), xytext=(f1, ay),
                arrowprops=dict(arrowstyle='<->', color=DIM_C,
                                lw=1.0, mutation_scale=7))
    # Extension lines
    ax.plot([f1, f1], [y_fig, ay], color=DIM_C, lw=0.7, ls=':')
    ax.plot([f2, f2], [y_fig, ay], color=DIM_C, lw=0.7, ls=':')
    # Label
    ax.text(mid, ay, f' {label} ', ha='center',
            va='bottom' if above else 'top',
            fontsize=DIM_FS, color=DIM_C,
            bbox=dict(fc='#FDFDFC', ec='none', pad=1.5), zorder=6)


def dim_v(y1_r, y2_r, x_fig, label, gap=0.22, left=True):
    """Vertical dim between two room y-depths (from top wall), at a figure x."""
    fy1 = ry(y1_r)
    fy2 = ry(y2_r)
    mid = (fy1 + fy2) / 2
    dx = -gap if left else gap
    ax_x = x_fig + dx
    ax.annotate('', xy=(ax_x, fy2), xytext=(ax_x, fy1),
                arrowprops=dict(arrowstyle='<->', color=DIM_C,
                                lw=1.0, mutation_scale=7))
    ax.plot([x_fig, ax_x], [fy1, fy1], color=DIM_C, lw=0.7, ls=':')
    ax.plot([x_fig, ax_x], [fy2, fy2], color=DIM_C, lw=0.7, ls=':')
    ax.text(ax_x, mid, f' {label} ', ha='right' if left else 'left',
            va='center', fontsize=DIM_FS, color=DIM_C, rotation=90,
            bbox=dict(fc='#FDFDFC', ec='none', pad=1.5), zorder=6)


TOP   = OY + ROOM_H      # figure y of the top wall
BOT_F = OY               # figure y of the bottom wall
LEFT  = OX               # figure x of left wall
RIGHT = OX + ROOM_W      # figure x of right wall

# ── Overall room dimensions ───────────────────────────────────────────────────
dim_h(0, ROOM_W, BOT_F, '9.834 m', gap=0.55, above=False)          # bottom
dim_v(0, ROOM_H, LEFT,  '8.83 m',  gap=0.75, left=True)            # left side

# ── Top wall callouts (above the room) ───────────────────────────────────────
dim_h(0, EA_w,          TOP, '1.67 m',   gap=0.30)                  # elem A
dim_h(EA_w, EB_x,       TOP, '1.21 m',   gap=0.65)                  # gap A→B
dim_h(EB_x, EB_x+EB_w, TOP, '0.914 m',  gap=0.30)                  # elem B
gap_to_tr = TR_x - (EB_x + EB_w)
dim_h(EB_x+EB_w, TR_x,  TOP, f'≈{gap_to_tr:.2f} m', gap=0.65)     # gap B→TR
dim_h(TR_x, ROOM_W,     TOP, '2.6 m',   gap=1.00)                  # TR block

# ── Right-side callouts ───────────────────────────────────────────────────────
dim_v(0, TR_h,           RIGHT, '2.6 m',  gap=0.55, left=False)     # main block H
dim_v(TR_h, TR_h+LR_h,  RIGHT, '0.73 m', gap=0.55, left=False)     # LR height

# 1.98 m horizontal inside top-right block (left of main to left of LR)
dim_h(TR_x, TR_x+1.98, ry(TR_h), '1.98 m', gap=0.25, above=False)

# 0.62 m width of LR element
dim_h(LR_x, ROOM_W, ry(TR_h+LR_h), '0.62 m', gap=0.22, above=False)

# 0.58 m width of bottom element
dim_h(BOT_x, ROOM_W, ry(BOT_yt+BOT_h), '0.58 m', gap=0.22, above=False)


# ── Grid lines (light) ────────────────────────────────────────────────────────
for xi in np.arange(0, ROOM_W + 0.01, 1.0):
    ax.plot([rx(xi), rx(xi)], [OY, OY + ROOM_H],
            color='#D0D0C8', lw=0.4, ls='--', zorder=0)
for yi in np.arange(0, ROOM_H + 0.01, 1.0):
    ax.plot([OX, OX + ROOM_W], [ry(yi), ry(yi)],
            color='#D0D0C8', lw=0.4, ls='--', zorder=0)


# ── Title block ───────────────────────────────────────────────────────────────
title_cx = OX + ROOM_W / 2
ax.text(title_cx, OY + ROOM_H + MT - 0.35,
        'FLOOR PLAN',
        fontsize=15, fontweight='bold', color='#1A1A2E',
        ha='center', va='center', fontfamily='DejaVu Sans')

ax.text(title_cx, OY + ROOM_H + MT - 0.75,
        'Scale: 1 px = 0.01 m  |  All dimensions in metres',
        fontsize=7.5, color='#555570',
        ha='center', va='center', style='italic')

ax.text(title_cx, OY + ROOM_H + MT - 1.05,
        'Drawing not to be scaled from print — use stated dimensions',
        fontsize=6.5, color='#888890',
        ha='center', va='center', style='italic')


# ── Scale bar ────────────────────────────────────────────────────────────────
sb_x0 = OX + 0.1
sb_y  = OY - 1.2
sb_len = 2.0   # 2 m
ax.plot([sb_x0, sb_x0 + sb_len], [sb_y, sb_y], color='#1A1A2E', lw=3)
for tick_x in [sb_x0, sb_x0 + 1, sb_x0 + sb_len]:
    ax.plot([tick_x, tick_x], [sb_y - 0.07, sb_y + 0.07], '#1A1A2E', lw=2)
ax.fill_betweenx([sb_y - 0.05, sb_y + 0.05],
                 [sb_x0], [sb_x0 + 1], color='#1A1A2E', zorder=5)
ax.text(sb_x0,         sb_y - 0.18, '0',    ha='center', fontsize=7, color='#1A1A2E')
ax.text(sb_x0 + 1,     sb_y - 0.18, '1 m',  ha='center', fontsize=7, color='#1A1A2E')
ax.text(sb_x0 + sb_len,sb_y - 0.18, '2 m',  ha='center', fontsize=7, color='#1A1A2E')
ax.text(sb_x0 + sb_len/2, sb_y - 0.38, 'SCALE BAR',
        ha='center', fontsize=6, color='#777788')


# ── North arrow ───────────────────────────────────────────────────────────────
na_cx = OX + ROOM_W + MR - 0.6
na_cy = OY + 1.2
ax.annotate('', xy=(na_cx, na_cy + 0.55), xytext=(na_cx, na_cy - 0.55),
            arrowprops=dict(arrowstyle='->', color='#1A1A2E', lw=2.5,
                            mutation_scale=14))
ax.text(na_cx, na_cy + 0.78, 'N', ha='center', va='bottom',
        fontsize=11, fontweight='bold', color='#1A1A2E')


# ── Border ───────────────────────────────────────────────────────────────────
for lw, color in [(3.5, '#1A1A2E'), (1.5, '#1A1A2E')]:
    ax.add_patch(patches.Rectangle(
        (0.15, 0.15), FIG_W - 0.30, FIG_H - 0.30,
        lw=lw, edgecolor=color, facecolor='none', zorder=7
    ))


# ── Save ─────────────────────────────────────────────────────────────────────
OUT = '/workspaces/test/floorplan.png'
plt.savefig(OUT, dpi=150, bbox_inches='tight',
            facecolor='#FDFDFC', edgecolor='none', format='png')
plt.close()

print(f"Saved → {OUT}")
print(f"Canvas: {FIG_W:.2f} m × {FIG_H:.2f} m  |  150 DPI")
print(f"Pixel resolution: {int(FIG_W*150)} × {int(FIG_H*150)} px")
print(f"Scale: 1 px = 0.01 m = 1 cm")
