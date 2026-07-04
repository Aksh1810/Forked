import type { EngineRecord, Eval } from './schemas.js'
import { moverWinPct } from './win.js'

// Reference formula: lichess's published move-accuracy curve
// (lila, AccuracyPercent.scala):
//   accuracy = 103.1668 * exp(-0.04354 * winDiff) - 3.1669, clamped to 0..100
// where winDiff is win-probability loss in percentage points. Per spec, game
// accuracy applies this curve to the AVERAGE win-probability loss across the
// player's moves. Book plies are excluded: they are excluded from move
// classification entirely and are analyzed at a reduced node budget, so their
// pseudo-losses would pollute the average.
export function accuracyFromAvgLoss(avgLossPct: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * avgLossPct) - 3.1669
  return Math.min(100, Math.max(0, a))
}

export function gameAccuracies(
  record: Pick<EngineRecord, 'startEval' | 'plies'>,
  terminal: 'checkmate' | 'stalemate' | null,
): { white: number | null; black: number | null } {
  const losses = { white: [] as number[], black: [] as number[] }
  let before: Eval = record.startEval
  for (const p of record.plies) {
    const mover = p.ply % 2 === 1 ? 'white' : 'black'
    const wpBefore = moverWinPct(before, mover)
    const wpAfter =
      p.evalAfter === null
        ? terminal === 'checkmate'
          ? 100
          : 50
        : moverWinPct(p.evalAfter, mover)
    if (!p.book) losses[mover].push(Math.max(0, wpBefore - wpAfter))
    if (p.evalAfter !== null) before = p.evalAfter
  }
  const acc = (xs: number[]) =>
    xs.length ? accuracyFromAvgLoss(xs.reduce((a, b) => a + b, 0) / xs.length) : null
  return { white: acc(losses.white), black: acc(losses.black) }
}
