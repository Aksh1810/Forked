import type { EngineRecord, Eval } from './schemas.js'
import { GAME_PHASES, gamePhases, type GamePhase } from './phases.js'
import { moverWinPct } from './win.js'

// Reference formula: WintrChess (wintrcat/wintrchess, shared/src/lib/reporter/*),
// the strongest public reconstruction of chess.com's proprietary CAPS2.
// Applied PER MOVE, then game accuracy is the plain arithmetic mean of move
// accuracies — never the curve applied to the average loss. Averaging loss
// first and curving once (the old accuracyFromAvgLoss shortcut) is wrong by
// Jensen's inequality: the curve is convex over the relevant range, so a
// spiky game (many perfect moves + a couple of disasters) scores HIGHER on
// the averaged-loss path than the honest per-move mean, even at the same
// average loss. That was the root cause of our accuracy reading ~88% on a
// game chess.com scored 64.7%.
export function moveAccuracyPct(lossPct: number): number {
  const a = 103.16 * Math.exp(-0.04 * lossPct) - 3.17
  return Math.min(100, Math.max(0, a))
}

export function gameAccuracies(
  record: Pick<EngineRecord, 'startEval' | 'plies'>,
  terminal: 'checkmate' | 'stalemate' | null,
): { white: number | null; black: number | null } {
  const accs = { white: [] as number[], black: [] as number[] }
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
    if (p.evalAfter !== null) before = p.evalAfter
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return { white: mean(accs.white), black: mean(accs.black) }
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

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const out = {} as Record<GamePhase, { white: number | null; black: number | null }>
  for (const phase of GAME_PHASES) out[phase] = { white: mean(accs[phase].white), black: mean(accs[phase].black) }
  return out
}
