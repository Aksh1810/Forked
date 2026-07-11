'use client'

import { Fragment, useEffect } from 'react'
import Link from 'next/link'
import { area, scaleLinear, line } from 'd3'
import type { EngineRecord, Enriched, PlyAnalysis } from '@forked/shared'
import { bookHeadline, copy } from '../copy'
import { KEY_TIERS, TIER, TierIcon } from './classification'
import { formatEval } from './EvalBar'
import { Piece } from './pieces'

// The per-game eval graph: White's win probability as a bone-colored area
// over the game, with a colored dot on every notable ply. Dots are always
// visible (never hover-only); the whole plot area is a scrub target so
// dragging across the graph steps through the game; the selected ply is
// reported up so the move list and board can follow it.

// null evalAfter is a terminal checkmate/stalemate ply: carry the previous
// point instead of snapping back to the start eval (which drew a full-height
// spike at the right edge of every decisive game's graph).
function whitePct(ev: EngineRecord['plies'][number]['evalAfter'], prev: number): number {
  if (ev === null) return prev
  if (ev.type === 'mate') return ev.value > 0 ? 100 : 0
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ev.value)) - 1)
}

export function EvalGraph({
  record,
  enriched,
  selected,
  onSelect,
  turningPoint,
  width = 640,
  height = 200,
}: {
  record: EngineRecord
  enriched: Enriched[]
  selected: number | null
  onSelect: (ply: number) => void
  // The ply the game turned on (shared/classify.ts turningPoint()); marked
  // with an extra ring under its dot. Optional: absent for a quiet game.
  turningPoint?: number | null
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

  let prev = startWhite
  const pts = record.plies.map((p) => {
    prev = whitePct(p.evalAfter, prev)
    return { ply: p.ply, wp: prev }
  })
  const x = scaleLinear().domain([0, Math.max(1, record.plies.length)]).range([0, iw])
  const y = scaleLinear().domain([0, 100]).range([ih, 0])
  const path = line<{ wp: number }>().x((_, i) => x(i + 1)).y((d) => y(d.wp))(pts)
  const areaPath = area<{ wp: number }>().x((_, i) => x(i + 1)).y0(ih).y1((d) => y(d.wp))(pts)

  const selectedTier = selected !== null ? enriched[selected - 1] : null
  const cursorColor = selectedTier && selectedTier !== 'none' ? TIER[selectedTier].color : 'var(--muted)'
  const cursor = selected !== null ? { x: x(selected), pt: pts[selected - 1] } : null

  // Maps a pointer position to the nearest ply and reports it. The scrub rect
  // spans exactly ply 0..N, so the pointer's fraction of its rendered width IS
  // the ply fraction — no viewBox scale math needed.
  function plyFromPointer(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const p = Math.round(((e.clientX - rect.left) / rect.width) * pts.length)
    onSelect(Math.min(pts.length, Math.max(1, p)))
  }

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="game evaluation graph">
      <g transform={`translate(${m.left},${m.top})`}>
        <rect x={0} y={0} width={iw} height={ih} fill="#000" rx={4} />
        {/* #5a5a5a, not --line (#262a33): the midline sits on the #000 graph
            panel, not the page void, where --line falls under 3:1. */}
        <line x1={0} x2={iw} y1={y(50)} y2={y(50)} stroke="#5a5a5a" strokeWidth={1} />
        {areaPath && <path d={areaPath} fill="var(--bone)" />}
        {path && <path d={path} fill="none" stroke="var(--bone)" strokeWidth={1.5} />}
        {/* Scrub target first (painted below) so the dots on top stay clickable. */}
        <rect
          x={0}
          y={0}
          width={iw}
          height={ih}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            plyFromPointer(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) plyFromPointer(e)
          }}
        />
        {cursor && (
          <>
            <line x1={cursor.x} x2={cursor.x} y1={0} y2={ih} stroke={cursorColor} strokeWidth={2} />
            <circle cx={cursor.x} cy={y(cursor.pt.wp)} r={4} fill={cursorColor} style={{ pointerEvents: 'none' }} />
          </>
        )}
        {pts.map((p, i) => {
          const tier = enriched[i]
          if (!tier || !KEY_TIERS.has(tier)) return null
          const r = selected === p.ply ? 6 : 4
          return (
            <Fragment key={p.ply}>
              {turningPoint === p.ply && (
                <circle cx={x(i + 1)} cy={y(p.wp)} r={r + 4} fill="none" stroke="var(--bone)" strokeWidth={1} />
              )}
              <circle
                cx={x(i + 1)}
                cy={y(p.wp)}
                r={r}
                fill={TIER[tier].color}
                stroke={selected === p.ply ? 'var(--bone)' : 'none'}
                strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(p.ply)}
              >
                <title>{`ply ${p.ply}: ${TIER[tier].word}`}</title>
              </circle>
            </Fragment>
          )
        })}
      </g>
    </svg>
  )
}

function HalfMove({
  ply,
  san,
  tier,
  mover,
  selected,
  onSelect,
}: {
  ply: number
  san: string
  tier: Enriched
  mover: 'white' | 'black'
  selected: boolean
  onSelect: (ply: number) => void
}) {
  const lead = san[0]
  const glyph = lead && /[KQRBN]/.test(lead) ? (mover === 'white' ? lead : lead.toLowerCase()) : null
  // SAN is tinted for the tiers worth calling out; best/excellent/good/book
  // stay the default text color so the list doesn't turn into a rainbow.
  const tinted = tier === 'brilliant' || tier === 'great' || tier === 'inaccuracy' || tier === 'mistake' || tier === 'miss' || tier === 'blunder'
  return (
    <button className={`move-cell${selected ? ' move-selected' : ''}`} onClick={() => onSelect(ply)}>
      {tier !== 'none' && <TierIcon kind={tier} size={14} />}
      {glyph && (
        <span style={{ display: 'inline-block', width: '1em', height: '1em', verticalAlign: 'middle' }}>
          <Piece piece={glyph} />
        </span>
      )}
      <span style={{ color: tinted ? TIER[tier].color : 'var(--bone)' }}>{san}</span>
    </button>
  )
}

// A tappable move list in paired full-move rows, chess.com style: move
// number, White's SAN, Black's SAN, each with a leading piece glyph and a
// tier chip. Selecting a ply here or on the graph drives the board and coach
// card. While previewing the best move for a ply, an indented variation row
// renders right after that ply's pair.
export function MoveList({
  record,
  sans,
  enriched,
  selected,
  previewPly,
  bestSan,
  onSelect,
  filter,
}: {
  record: EngineRecord
  sans: string[]
  enriched: Enriched[]
  selected: number | null
  previewPly: number | null
  bestSan: string | null
  onSelect: (ply: number) => void
  // 'key' keeps only pairs where either half landed a notable tier (the same
  // set the eval graph dots use) — the fastest path to "show me what went
  // wrong". Filters whole pairs, not halves, so numbering stays intact.
  filter: 'all' | 'key'
}) {
  useEffect(() => {
    document.querySelector('.move-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  let rows: { num: number; white: PlyAnalysis; black?: PlyAnalysis }[] = []
  for (let i = 0; i < record.plies.length; i += 2) {
    rows.push({ num: i / 2 + 1, white: record.plies[i], black: record.plies[i + 1] })
  }
  if (filter === 'key') {
    rows = rows.filter((row) => {
      const wt = enriched[row.white.ply - 1]
      const bt = row.black && enriched[row.black.ply - 1]
      return (wt && KEY_TIERS.has(wt)) || (bt && KEY_TIERS.has(bt))
    })
  }

  return (
    <ol className="mono move-pairs" aria-label="move list">
      {rows.map((row) => {
        const previewInRow =
          previewPly === row.white.ply ? row.white.ply : previewPly === row.black?.ply ? row.black.ply : null
        return (
          <Fragment key={row.num}>
            <li className="move-pair">
              <span className="quiet">{row.num}.</span>
              <HalfMove
                ply={row.white.ply}
                san={sans[row.white.ply - 1] ?? row.white.played}
                tier={enriched[row.white.ply - 1] ?? 'none'}
                mover="white"
                selected={selected === row.white.ply}
                onSelect={onSelect}
              />
              {row.black ? (
                <HalfMove
                  ply={row.black.ply}
                  san={sans[row.black.ply - 1] ?? row.black.played}
                  tier={enriched[row.black.ply - 1] ?? 'none'}
                  mover="black"
                  selected={selected === row.black.ply}
                  onSelect={onSelect}
                />
              ) : (
                <span />
              )}
            </li>
            {previewInRow !== null && bestSan && (
              <li className="move-variation quiet mono">
                {`${Math.ceil(previewInRow / 2)}${previewInRow % 2 ? '.' : '...'} `}
                <TierIcon kind="best" size={14} /> {bestSan}
              </li>
            )}
          </Fragment>
        )
      })}
    </ol>
  )
}

// The coach card: a rounded, light card with the tier icon, a one-line
// headline ("<san> is a mistake"), an eval chip, and a quiet second line
// naming the engine's line when one is on offer. The page resolves
// san/tier/bestSan/pv (memoized); this only renders them.
export function CoachCard({
  p,
  tier,
  san,
  bestSan,
  pv,
  outcome,
  nextHref,
  preview,
  motif,
  openingName,
}: {
  p: PlyAnalysis | null
  tier: Enriched
  san: string | null
  bestSan: string | null
  pv: string[]
  // End-of-review closure: outcome line + a link onward, shown once
  // selected === total. Both undefined outside that moment.
  outcome?: string | null
  nextHref?: string
  // Best-preview / explore mode: the headline switches entirely so the mode
  // is never ambiguous (Cooper: never leave the user unsure which mode
  // they're in).
  preview?: boolean
  // Structured coach-motif reason for this ply (shared/classify.ts
  // moveMotif); the page turns it into a sentence via copy.ts templates.
  motif?: string | null
  // Book-tier plies name the opening they belong to.
  openingName?: string | null
}) {
  if (preview) {
    return (
      <div className="coach-card">
        <div className="coach-head">
          <TierIcon kind="best" size={22} />
          <strong>{copy.coach.exploring}</strong>
        </div>
      </div>
    )
  }
  if (!p || !san) return <p className="coach-card quiet">{copy.coach.hint}</p>
  const headline = tier === 'book' && openingName ? bookHeadline(san, openingName) : `${san} ${copy.coach.is[tier]}`
  return (
    <div className={`coach-card${tier === 'blunder' ? ' coach-flash' : ''}`}>
      <div className="coach-head">
        <TierIcon kind={tier} size={22} />
        <strong>{headline}</strong>
        {p.evalAfter && <span className="coach-eval mono">{formatEval(p.evalAfter)}</span>}
      </div>
      {motif && <div className="quiet coach-pv">{motif}</div>}
      {bestSan && (
        <div className="quiet coach-pv">
          {copy.coach.bestWas(bestSan)} {pv.length > 0 && <span className="mono">{pv.join(' ')}</span>}
        </div>
      )}
      {outcome && (
        <div className="coach-outcome">
          <p>{outcome}</p>
          {nextHref && <Link href={nextHref}>{copy.coach.analyzeAnother}</Link>}
        </div>
      )}
    </div>
  )
}

export { whitePct }
