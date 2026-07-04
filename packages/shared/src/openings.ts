import { MAX_OPENING_PLIES, OPENINGS } from './openings.gen.js'

export interface OpeningMatch {
  eco: string
  name: string
  plies: number
}

// Longest-prefix match against the embedded lichess-org/chess-openings
// dataset. Every ply inside the matched prefix is a book move.
export function matchOpening(uciMoves: readonly string[]): OpeningMatch | null {
  for (let n = Math.min(uciMoves.length, MAX_OPENING_PLIES); n >= 1; n--) {
    const hit = OPENINGS[uciMoves.slice(0, n).join(' ')]
    if (hit) return { eco: hit[0], name: hit[1], plies: n }
  }
  return null
}
