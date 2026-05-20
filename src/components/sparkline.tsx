export function Sparkline({
  points,
  width = 120,
  height = 36,
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
  const linePath = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  // Closed path for gradient fill (line, then down to baseline, then close).
  const fillPath = `${linePath} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`;
  const uid = `spark-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${uid})`} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
