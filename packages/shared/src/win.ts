import type { Eval } from './schemas.js'

// Sigmoid used by lichess to map centipawns to win probability (0..100).
export function winPctFromCp(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

// White's win probability for a White-perspective evaluation. Mate maps to
// 100 or 0; the mate-in-N number is retained separately for display only.
export function whiteWinPct(ev: Eval): number {
  if (ev.type === 'mate') return ev.value > 0 ? 100 : 0
  return winPctFromCp(ev.value)
}

export function moverWinPct(ev: Eval, mover: 'white' | 'black'): number {
  const w = whiteWinPct(ev)
  return mover === 'white' ? w : 100 - w
}

// The index of the steepest single step in a win-probability series — the ply
// the graph falls off. Every cliff rendering (the on-page sparkline and the
// share card's bar version) marks the same point because they all read this.
// Returns 1 for a series with no movement, and 0 for a series too short to
// have a step.
export function cliffIndex(series: readonly number[]): number {
  if (series.length < 2) return 0
  let at = 1
  let biggest = 0
  for (let i = 1; i < series.length; i++) {
    const d = Math.abs(series[i] - series[i - 1])
    if (d > biggest) {
      biggest = d
      at = i
    }
  }
  return at
}
