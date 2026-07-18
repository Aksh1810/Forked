import { Chess, normalizeMove } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { makeSquare, parseSquare, squareRank } from 'chessops/util'
import { standardUci } from '@forked/shared'

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
