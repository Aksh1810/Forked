import { Chess, normalizeMove } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { makeSquare, parseSquare, squareRank } from 'chessops/util'
import { standardUci, type Eval } from '@forked/shared'

export type ClickResult =
  | { kind: 'select'; from: string }
  | { kind: 'deselect' }
  | { kind: 'reset' }
  | { kind: 'move'; uci: string }

// Pure move-input state machine shared by retry mode (A2) and live explore
// mode (Wave 2): first click on the side-to-move's own piece selects it, a
// second click on a legal destination plays it, clicking the selected square
// again deselects, and any other click (empty square, opponent piece with
// nothing selected, illegal destination) just clears selection. Promotion is
// auto-queen — ponytail: no picker, underpromotion is rare in casual
// exploring; add a picker if that ever bites.
export function clickMove(fen: string, from: string | null, sq: string): ClickResult {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
  const sqIdx = parseSquare(sq)
  if (sqIdx === undefined) return { kind: 'reset' }
  const piece = pos.board.get(sqIdx)

  if (from === sq) return { kind: 'deselect' }
  if (piece && piece.color === pos.turn) return { kind: 'select', from: sq }
  if (from === null) return { kind: 'reset' }

  const fromIdx = parseSquare(from)
  if (fromIdx === undefined) return { kind: 'reset' }
  const raw = { from: fromIdx, to: sqIdx }
  if (!pos.dests(fromIdx).has(normalizeMove(pos, raw).to)) return { kind: 'reset' }
  const promotes = pos.board.get(fromIdx)?.role === 'pawn' && (squareRank(sqIdx) === 0 || squareRank(sqIdx) === 7)
  return { kind: 'move', uci: standardUci(pos, promotes ? { ...raw, promotion: 'queen' } : raw) }
}

// Legal destination squares for the piece on `from`, for the Board `dests`
// dots — shared by retry and explore selection. ponytail: chessops castling
// dests land on the rook's own square (its internal king-takes-rook
// representation), not the king's landing square; shown as-is, fine for a
// subtle dot.
export function destsFor(fen: string, from: string | null): string[] | undefined {
  if (!from) return undefined
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
  const fromIdx = parseSquare(from)
  if (fromIdx === undefined) return undefined
  return [...pos.dests(fromIdx)].map(makeSquare)
}

// FIX 1a: the live engine's `terminal` update carries no eval — `bestmove
// (none)` on checkmate/stalemate never has a `pv`/`score` line for
// parseInfoLine to read. This derives the eval straight from the position
// itself instead, same source of truth pgn.ts's finalStatus() uses
// (pos.isCheckmate()/isStalemate()). Mate value can't be 0 (EvalSchema), so a
// delivered mate is reported as a nominal ±1 in the winner's sign — the eval
// bar only reads the sign/type for a terminal position, never the magnitude.
export function terminalEval(fen: string): Eval | null {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap()
  if (pos.isCheckmate()) return { type: 'mate', value: pos.turn === 'white' ? -1 : 1 }
  if (pos.isStalemate()) return { type: 'cp', value: 0 }
  return null
}
