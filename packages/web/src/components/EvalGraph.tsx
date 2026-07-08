'use client'

import { scaleLinear, line } from 'd3'
import type { EngineRecord } from '@forked/shared'

// The per-game eval graph: White's win probability as a bone line over the
// game, with a classification dot on every classified ply. Dots are always
// visible (never hover-only) and tappable for move detail; the selected ply is
// reported up so the move list can highlight it.
const DOT: Record<string, string> = {
  blunder: 'var(--blunder)',
  mistake: 'var(--mistake)',
  inaccuracy: 'var(--inaccuracy)',
}

function whitePct(ev: EngineRecord['plies'][number]['evalAfter'], startWhite: number): number {
  if (ev === null) return startWhite
  if (ev.type === 'mate') return ev.value > 0 ? 100 : 0
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ev.value)) - 1)
}

export function EvalGraph({
  record,
  selected,
  onSelect,
  width = 640,
  height = 200,
}: {
  record: EngineRecord
  selected: number | null
  onSelect: (ply: number) => void
  width?: number
  height?: number
}) {
  const m = { top: 12, right: 12, bottom: 20, left: 32 }
  const iw = width - m.left - m.right
  const ih = height - m.top - m.bottom
  const startWhite =
    record.startEval.type === 'mate'
      ? record.startEval.value > 0
        ? 100
        : 0
      : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * record.startEval.value)) - 1)

  const pts = record.plies.map((p) => ({ ply: p.ply, wp: whitePct(p.evalAfter, startWhite), c: p.classification }))
  const x = scaleLinear().domain([0, Math.max(1, record.plies.length)]).range([0, iw])
  const y = scaleLinear().domain([0, 100]).range([ih, 0])
  const path = line<{ wp: number }>().x((_, i) => x(i + 1)).y((d) => y(d.wp))(pts)

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="game evaluation graph">
      <g transform={`translate(${m.left},${m.top})`}>
        <rect x={0} y={0} width={iw} height={ih} fill="#000" rx={4} />
        <line x1={0} x2={iw} y1={y(50)} y2={y(50)} stroke="var(--line)" strokeWidth={1} />
        {path && <path d={path} fill="none" stroke="var(--bone)" strokeWidth={1.5} />}
        {pts.map((p, i) =>
          p.c !== 'none' ? (
            <circle
              key={p.ply}
              cx={x(i + 1)}
              cy={y(p.wp)}
              r={selected === p.ply ? 6 : 4}
              fill={DOT[p.c] ?? 'var(--muted)'}
              stroke={selected === p.ply ? 'var(--bone)' : 'none'}
              strokeWidth={1.5}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(p.ply)}
            >
              <title>{`ply ${p.ply}: ${p.c}`}</title>
            </circle>
          ) : null,
        )}
      </g>
    </svg>
  )
}

// A tappable move list in mono with classification chips, paired with the
// graph. Selecting a ply here or on the graph shows played vs best.
export function MoveList({
  record,
  selected,
  onSelect,
}: {
  record: EngineRecord
  selected: number | null
  onSelect: (ply: number) => void
}) {
  return (
    <ol className="mono move-list" aria-label="move list">
      {record.plies.map((p) => (
        <li key={p.ply}>
          <button
            className={`move-cell${selected === p.ply ? ' move-selected' : ''}`}
            onClick={() => onSelect(p.ply)}
          >
            <span className="quiet">{Math.ceil(p.ply / 2)}{p.ply % 2 ? '.' : '...'}</span> {p.played}
            {p.book && <span className="chip-mark book"> book</span>}
            {p.classification === 'blunder' && <span className="chip-mark blunder">??</span>}
            {p.classification === 'mistake' && <span className="chip-mark mistake">?</span>}
            {p.classification === 'inaccuracy' && <span className="chip-mark inaccuracy">?!</span>}
          </button>
        </li>
      ))}
    </ol>
  )
}

export function MoveDetail({ record, ply }: { record: EngineRecord; ply: number }) {
  const p = record.plies.find((q) => q.ply === ply)
  if (!p) return null
  return (
    <div className="move-detail mono">
      <div>
        played <strong>{p.played}</strong>
        {p.played !== p.best && (
          <>
            {' '}
            best <span style={{ color: 'var(--best)' }}>{p.best}</span>
          </>
        )}
      </div>
      {p.pv.length > 0 && <div className="quiet">line: {p.pv.join(' ')}</div>}
    </div>
  )
}

export { whitePct }
