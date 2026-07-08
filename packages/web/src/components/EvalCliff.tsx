// A small win-probability sparkline for the worst-blunder slide and the card.
// White-perspective win% (0..100) as a bone line on a black track, with the
// cliff drop marked. Inline SVG: a polyline is not worth a chart library.
export function EvalCliff({ series, width = 280, height = 72 }: { series: number[]; width?: number; height?: number }) {
  if (series.length < 2) return null
  const pad = 4
  const x = (i: number) => pad + (i / (series.length - 1)) * (width - 2 * pad)
  const y = (v: number) => pad + (1 - v / 100) * (height - 2 * pad)
  const points = series.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  // The steepest single drop is the blunder; mark its end point.
  let dropAt = 1
  let biggest = 0
  for (let i = 1; i < series.length; i++) {
    const d = Math.abs(series[i] - series[i - 1])
    if (d > biggest) {
      biggest = d
      dropAt = i
    }
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="evaluation cliff">
      <rect x={0} y={0} width={width} height={height} fill="#000" rx={6} />
      <line x1={pad} y1={y(50)} x2={width - pad} y2={y(50)} stroke="var(--line)" strokeWidth={1} />
      <polyline points={points} fill="none" stroke="var(--bone)" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(dropAt)} cy={y(series[dropAt])} r={4} fill="var(--blunder)" />
    </svg>
  )
}
