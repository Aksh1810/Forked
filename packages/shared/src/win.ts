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
