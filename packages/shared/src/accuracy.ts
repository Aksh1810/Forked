import type { EngineRecord, Eval } from './schemas.js'
import { GAME_PHASES, gamePhases, type GamePhase } from './phases.js'
import { moverWinPct } from './win.js'

// Curve constants are an empirical fit against chess.com's own published
// per-game accuracies (chess.com public API `accuracies` field), 62 games x 2
// colors = 124 data points, July 2026, rmse 6.2 — NOT the lichess/wintrchess
// curve. Applied PER MOVE, then game accuracy is a blend of the plain
// arithmetic mean of move accuracies (85%) and the per-color best-move rate
// (15%) — see gameAccuracies — never the curve applied to the average loss.
// Averaging loss first and curving once (the old accuracyFromAvgLoss
// shortcut) is wrong by Jensen's inequality: the curve is convex over the
// relevant range, so a spiky game (many perfect moves + a couple of
// disasters) scores HIGHER on the averaged-loss path than the honest
// per-move mean, even at the same average loss. Scores below 62 get an
// additional stretch toward 0 (also in gameAccuracies) to match chess.com's
// low-end spread.
// ponytail: refit when more reviewed games accumulate.
export function moveAccuracyPct(lossPct: number): number {
  const a = 180 * Math.exp(-0.05 * lossPct) - 80
  return Math.min(100, Math.max(0, a))
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// Calibration tunables for gameAccuracies (fit jointly with the curve above).
const BEST_RATE_WEIGHT = 0.15 // blend weight of the best-move rate vs mean move accuracy
const STRETCH_BELOW = 62 // scores under this get stretched toward 0 …
const STRETCH_FACTOR = 0.5 // … by this much per point of shortfall

export function gameAccuracies(
  record: Pick<EngineRecord, 'startEval' | 'plies'>,
  terminal: 'checkmate' | 'stalemate' | null,
): { white: number | null; black: number | null } {
  const accs = { white: [] as number[], black: [] as number[] }
  const nonBook = { white: { total: 0, best: 0 }, black: { total: 0, best: 0 } }
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
    // Book plies count as full credit (chess.com/WintrChess grade theory as
    // free) rather than being scored off their reduced-node-budget eval,
    // whose pseudo-loss would otherwise pollute the mean.
    accs[mover].push(p.book ? 100 : moveAccuracyPct(Math.max(0, wpBefore - wpAfter)))
    if (!p.book) {
      nonBook[mover].total++
      if (p.played === p.best) nonBook[mover].best++
    }
    if (p.evalAfter !== null) before = p.evalAfter
  }
  const blend = (color: 'white' | 'black') => {
    const meanAcc = mean(accs[color])
    if (meanAcc === null) return null
    const { total, best } = nonBook[color]
    const bestPct = total ? (100 * best) / total : null
    let raw = bestPct === null ? meanAcc : BEST_RATE_WEIGHT * bestPct + (1 - BEST_RATE_WEIGHT) * meanAcc
    if (raw < STRETCH_BELOW) raw = raw - (STRETCH_BELOW - raw) * STRETCH_FACTOR
    return Math.min(100, Math.max(0, raw))
  }
  return { white: blend('white'), black: blend('black') }
}

// Same loss walk as gameAccuracies, but bucketed by game phase instead of
// collapsed to one number. bookPlies is the count of LEADING plies with
// p.book (book moves only ever come first in the game, so this stops at the
// first non-book ply rather than counting every book ply anywhere).
export function phaseAccuracies(
  record: Pick<EngineRecord, 'startEval' | 'plies' | 'uciMoves'>,
  terminal: 'checkmate' | 'stalemate' | null,
): Record<GamePhase, { white: number | null; black: number | null }> {
  let bookPlies = 0
  for (const p of record.plies) {
    if (!p.book) break
    bookPlies++
  }
  const phaseOf = gamePhases(record.uciMoves, bookPlies)

  const accs: Record<GamePhase, { white: number[]; black: number[] }> = {
    opening: { white: [], black: [] },
    middlegame: { white: [], black: [] },
    endgame: { white: [], black: [] },
  }
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
    // Book plies land in the opening bucket (phaseOf already routes leading
    // plies there) at full credit — same reasoning as gameAccuracies.
    accs[phaseOf[p.ply - 1]][mover].push(p.book ? 100 : moveAccuracyPct(Math.max(0, wpBefore - wpAfter)))
    if (p.evalAfter !== null) before = p.evalAfter
  }

  const out = {} as Record<GamePhase, { white: number | null; black: number | null }>
  for (const phase of GAME_PHASES) out[phase] = { white: mean(accs[phase].white), black: mean(accs[phase].black) }
  return out
}
