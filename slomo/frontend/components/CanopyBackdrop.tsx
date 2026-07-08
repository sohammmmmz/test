/**
 * The forest behind the glass: a deep bark gradient, two depths of drifting
 * fireflies, and a soft vignette. Pure CSS animation (GPU-composited
 * transforms only), fixed behind everything, throttled to nothing when the
 * user prefers reduced motion via globals.css.
 */

const FIREFLIES = [
  // [left %, top %, scale, duration s, delay s, far?]
  [8, 22, 1, 16, 0, false],
  [18, 64, 0.7, 21, 3, true],
  [27, 38, 0.8, 18, 7, false],
  [38, 78, 0.6, 24, 1, true],
  [46, 18, 0.9, 17, 5, false],
  [55, 55, 0.7, 22, 9, true],
  [63, 30, 1, 15, 2, false],
  [71, 70, 0.6, 25, 6, true],
  [79, 44, 0.8, 19, 4, false],
  [87, 24, 0.7, 23, 8, true],
  [93, 60, 0.9, 18, 10, false],
  [33, 10, 0.6, 26, 11, true],
] as const;

export function CanopyBackdrop() {
  return (
    <div aria-hidden className="canopy-backdrop">
      <div className="canopy-gradient" />
      {FIREFLIES.map(([left, top, scale, dur, delay, far], i) => (
        <span
          key={i}
          className={far ? "firefly firefly-far" : "firefly"}
          style={{
            left: `${left}%`,
            top: `${top}%`,
            transform: `scale(${scale})`,
            animationDuration: `${dur}s`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
      <div className="canopy-vignette" />
    </div>
  );
}
