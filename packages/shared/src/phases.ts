import { Chess, normalizeMove } from 'chessops/chess'
import { parseUci } from 'chessops/util'

export type GamePhase = 'opening' | 'middlegame' | 'endgame'
export const GAME_PHASES: readonly GamePhase[] = ['opening', 'middlegame', 'endgame']

// ponytail: simple documented heuristic; refine only if the insights read
// wrong. Opening: within the book prefix or the first 16 plies, whichever is
// longer. Endgame: from the first position with 12 or fewer men on the board.
export function gamePhases(uciMoves: readonly string[], bookPlies: number): GamePhase[] {
  const openingUntil = Math.max(bookPlies, 16)
  const pos = Chess.default()
  let inEndgame = false
  return uciMoves.map((u, idx) => {
    const raw = parseUci(u)
    const move = raw && normalizeMove(pos, raw)
    if (!move || !pos.isLegal(move)) throw new Error(`illegal uci move "${u}" at ply ${idx + 1}`)
    pos.play(move)
    if (!inEndgame && pos.board.occupied.size() <= 12) inEndgame = true
    if (inEndgame) return 'endgame'
    return idx + 1 <= openingUntil ? 'opening' : 'middlegame'
  })
}
