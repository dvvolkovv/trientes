export function Sparkline({
  points,
  width = 80,
  height = 24,
}: {
  points: number[] | null | undefined;
  width?: number;
  height?: number;
}) {
  if (!points || points.length < 2) {
    return <div style={{ width, height }} className="opacity-30" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const stepX = width / (points.length - 1);
  const d = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const isUp = points[points.length - 1] >= points[0];
  const stroke = isUp ? "#22c55e" : "#ef4444"; // green-500 / red-500

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
