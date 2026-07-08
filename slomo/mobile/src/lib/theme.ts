/** Canopy terminal — same identity as the web frontend. */
export const canopy = {
  bark950: "#12160f",
  bark900: "#181d14",
  canopy900: "#1e2419",
  canopy800: "#262d20",
  canopy700: "#333b2b",
  moss500: "#8aa86f",
  moss400: "#a3bd8c",
  moss300: "#c0d3ae",
  amber500: "#dfa03c",
  amber400: "#eab45f",
  cream100: "#f3f0e4",
  cream300: "#d9d5c3",
  cream500: "#a5a292",
  cream700: "#6f6d61",
  // validated dataviz palette, dark-surface steps (fixed per entity)
  seriesCpu: "#3987e5",
  seriesMem: "#199e70",
  seriesTemp: "#c98500",
  seriesGpu: "#008300",
  statusGood: "#0ca30c",
  statusWarning: "#fab219",
  statusSerious: "#ec835a",
  statusCritical: "#d03b3b",
} as const;

export const glassCard = {
  backgroundColor: "rgba(30, 36, 25, 0.86)",
  borderColor: "rgba(243, 240, 228, 0.07)",
  borderWidth: 1,
  borderRadius: 16,
} as const;
