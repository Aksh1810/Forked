'use client'

import { sanMoves } from '@forked/shared'
import type { EngineUpdate } from '../lib/engine'
import { formatEval } from './EvalBar'
import { copy } from '../copy'

// The chess.com-style live engine panel: up to three MultiPV lines, each a
// clickable row (eval chip + SAN preview) that plays the line's first move.
// Fixed height (.engine-lines in globals.css) so the panel below never
// shifts as lines stream in.
export function EngineLines({
  status,
  update,
  prefixUci,
  onPlayMove,
}: {
  status: 'off' | 'loading' | 'ready' | 'failed'
  update: EngineUpdate | null
  prefixUci: string[]
  onPlayMove: (uci: string) => void
}) {
  return (
    <div className="engine-lines">
      {status === 'failed' && <p className="quiet">{copy.coach.engineLinesUnavailable}</p>}
      {(status === 'loading' || (status === 'ready' && !update)) && (
        <p className="quiet">{copy.coach.engineLinesLoading}</p>
      )}
      {status === 'ready' && update && (
        <>
          <p className="quiet mono engine-lines-depth">{copy.coach.engineDepth(update.depth)}</p>
          {update.lines.map((l, i) => (
            <button key={i} className="engine-line mono" onClick={() => onPlayMove(l.pvUci[0])}>
              <span className="engine-line-eval">{formatEval(l.eval)}</span>
              <span className="engine-line-sans">{sanMoves(l.pvUci.slice(0, 6), prefixUci).join(' ')}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
