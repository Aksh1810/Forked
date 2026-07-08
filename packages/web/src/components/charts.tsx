'use client'

import { scaleBand, scaleLinear, line } from 'd3'

// Dashboard charts: bone on void, d3 scales, 1px --line gridlines, no chart
// borders, no fills except classification meaning. Every data point is
// rendered visibly (dots, bar labels); hover may add detail but is never the
// only path to it, per the no-hover-only rule.

const BONE = 'var(--bone)'
const LINE = 'var(--line)'
const MUTED = 'var(--muted)'
const BLUNDER = 'var(--blunder)'

export function LineChart({
  data,
  width = 520,
  height = 220,
}: {
  data: { label: string; value: number }[]
  width?: number
  height?: number
}) {
  const m = { top: 16, right: 16, bottom: 32, left: 40 }
  const iw = width - m.left - m.right
  const ih = height - m.top - m.bottom
  if (data.length === 0) return <Empty />
  const x = scaleLinear().domain([0, Math.max(1, data.length - 1)]).range([0, iw])
  const y = scaleLinear().domain([0, 100]).range([ih, 0])
  const path = line<{ value: number }>()
    .x((_, i) => x(i))
    .y((d) => y(d.value))(data)

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="accuracy trend by month">
      <g transform={`translate(${m.left},${m.top})`}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={1} />
            <text x={-8} y={y(t)} textAnchor="end" dominantBaseline="middle" fill={MUTED} fontSize={11}>
              {t}
            </text>
          </g>
        ))}
        {path && <path d={path} fill="none" stroke={BONE} strokeWidth={2} />}
        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={x(i)} cy={y(d.value)} r={3} fill={BONE} />
            <text x={x(i)} y={ih + 18} textAnchor="middle" fill={MUTED} fontSize={11}>
              {d.label.slice(2)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

export function BarChart({
  data,
  width = 520,
  height = 240,
  unit = '%',
}: {
  data: { label: string; value: number; sub?: string }[]
  width?: number
  height?: number
  unit?: string
}) {
  const m = { top: 16, right: 16, bottom: 64, left: 40 }
  const iw = width - m.left - m.right
  const ih = height - m.top - m.bottom
  if (data.length === 0) return <Empty />
  const max = Math.max(1, ...data.map((d) => d.value))
  const x = scaleBand().domain(data.map((d) => d.label)).range([0, iw]).padding(0.3)
  const y = scaleLinear().domain([0, max]).range([ih, 0])

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="blunder rate by opening family">
      <g transform={`translate(${m.left},${m.top})`}>
        <line x1={0} x2={iw} y1={ih} y2={ih} stroke={LINE} strokeWidth={1} />
        {data.map((d) => {
          const bx = x(d.label) ?? 0
          const bh = ih - y(d.value)
          return (
            <g key={d.label}>
              <rect x={bx} y={y(d.value)} width={x.bandwidth()} height={bh} fill={BLUNDER} rx={2} />
              <text x={bx + x.bandwidth() / 2} y={y(d.value) - 6} textAnchor="middle" fill={MUTED} fontSize={11}>
                {d.value.toFixed(unit === '%' ? 1 : 0)}
                {unit}
              </text>
              <text
                x={bx + x.bandwidth() / 2}
                y={ih + 14}
                textAnchor="end"
                fill={MUTED}
                fontSize={10}
                transform={`rotate(-35, ${bx + x.bandwidth() / 2}, ${ih + 14})`}
              >
                {d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

function Empty() {
  return <p className="quiet">Not enough data yet.</p>
}
