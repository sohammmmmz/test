import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/**
 * 2px line + fading area fill, per the dataviz mark spec. Drawn in a
 * normalized 0–100 viewBox with a non-scaling stroke so it needs no layout
 * measurement (identical rendering on native and web).
 */
export function Sparkline({
  points,
  color,
  height = 44,
}: {
  points: number[];
  color: string;
  height?: number;
}) {
  if (points.length < 2) return <View style={{ height }} />;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L100,${height} L0,${height} Z`;
  const gid = `g-${color.replace("#", "")}`;

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.25} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${gid})`} />
      <Path
        d={line}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}
