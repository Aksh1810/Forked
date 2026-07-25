import type { EngineRecord, PlyAnalysis } from './schemas.js'
import { moverWinPct } from './win.js'
import { fenBeforePly } from './walk.js'

// "The moment you lost": the viewer's single worst move — the biggest win%
// drop among the plies THEY played. Mirrors turningPoint's threshold (a
// <20-point loss never really turned the game) but is scoped to one side, so
// the moment is about the viewer, not whichever player happened to blunder.
// Returns null when the viewer never had a real collapse (a clean game or a
// slow slide with no single cliff).
export interface Moment {
  ply: number
  side: 'white' | 'black'
  playedUci: string
  bestUci: string
  // The opponent's actual reply that punished the move (null if the game
  // ended on the blunder).
  refutationUci: string | null
  wpBefore: number
  wpAfter: number
  loss: number
  // Viewer-perspective win% window around the moment, for the cliff sparkline.
  cliff: number[]
  fenBefore: string
  fenAfter: string
  fenRefuted: string | null
}

export function momentFor(record: EngineRecord, side: 'white' | 'black'): Moment | null {
  let before = record.startEval
  let best: { ply: number; loss: number; wpBefore: number; wpAfter: number; p: PlyAnalysis } | null = null
  for (const p of record.plies) {
    const mover = p.ply % 2 === 1 ? 'white' : 'black'
    const wpBefore = moverWinPct(before, mover)
    const wpAfter = p.evalAfter === null ? 100 : moverWinPct(p.evalAfter, mover)
    const loss = wpBefore - wpAfter
    if (mover === side && (!best || loss > best.loss)) {
      best = { ply: p.ply, loss, wpBefore, wpAfter, p }
    }
    if (p.evalAfter !== null) before = p.evalAfter
  }
  if (!best || best.loss < 20) return null

  const { ply, p } = best
  // A short window (a few plies before through a couple after) as the
  // viewer's win%, so the sparkline shows the run-up and the fall.
  const from = Math.max(0, ply - 5)
  const to = Math.min(record.plies.length, ply + 2)
  const baseEval = from === 0 ? record.startEval : record.plies[from - 1].evalAfter ?? record.startEval
  const cliff: number[] = [Math.round(moverWinPct(baseEval, side))]
  for (let i = from; i < to; i++) {
    const ev = record.plies[i].evalAfter
    if (ev === null) break
    cliff.push(Math.round(moverWinPct(ev, side)))
  }

  const refutationUci = record.uciMoves[ply] ?? null // ply is 1-based; uciMoves[ply] is the reply
  return {
    ply,
    side,
    playedUci: p.played,
    bestUci: p.best,
    refutationUci,
    wpBefore: Math.round(best.wpBefore),
    wpAfter: Math.round(best.wpAfter),
    loss: Math.round(best.loss),
    cliff,
    fenBefore: fenBeforePly(record.uciMoves, ply),
    fenAfter: fenBeforePly(record.uciMoves, ply + 1),
    fenRefuted: refutationUci ? fenBeforePly(record.uciMoves, ply + 2) : null,
  }
}
