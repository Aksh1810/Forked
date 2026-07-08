import { Chess, normalizeMove } from 'chessops/chess'
import { parseUci } from 'chessops/util'
import { userMoves, type AnalyzedGame } from './insights.js'

// The delighter: one rotating weird-stat slot, whichever is most statistically
// distinctive for this user. Each candidate carries a distinctiveness score;
// the highest scorer that clears its floor wins. Deterministic, never random.
export type Delighter =
  | { kind: 'longest-game'; plies: number; opponent: string }
  | { kind: 'most-faced'; opponent: string; count: number }
  | { kind: 'blundered-square'; square: string; count: number }
  | { kind: 'favorite-piece'; piece: string; count: number }
  | { kind: 'comebacks'; count: number }

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

// Piece moved for a user ply, by replaying to the position before it. Only
// used for the favorite-piece tally, so cheap enough to replay per game.
function movedPieces(g: AnalyzedGame): string[] {
  if (!g.userColor) return []
  const pos = Chess.default()
  const pieces: string[] = []
  for (let i = 0; i < g.record.uciMoves.length; i++) {
    const raw = parseUci(g.record.uciMoves[i])
    const move = raw && normalizeMove(pos, raw)
    if (!move || !pos.isLegal(move)) break
    const mover = i % 2 === 0 ? 'white' : 'black'
    if (mover === g.userColor && 'from' in move) {
      const piece = pos.board.get(move.from)
      if (piece) pieces.push(roleToChar(piece.role))
    }
    pos.play(move)
  }
  return pieces
}

function roleToChar(role: string): string {
  return role === 'knight' ? 'n' : role[0]
}

export function selectDelighter(games: readonly AnalyzedGame[]): Delighter | null {
  const userGames = games.filter((g) => g.userColor)
  if (!userGames.length) return null
  const allMoves = userGames.flatMap(userMoves)

  const candidates: { d: Delighter; score: number }[] = []

  // Longest game: distinctive when it dwarfs the median.
  const lengths = userGames.map((g) => g.record.plies.length)
  const longest = userGames.reduce((a, b) => (b.record.plies.length > a.record.plies.length ? b : a))
  const medianLen = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)]
  if (longest.record.plies.length >= 80 && longest.record.plies.length >= medianLen * 1.8) {
    candidates.push({
      d: {
        kind: 'longest-game',
        plies: longest.record.plies.length,
        opponent: longest.userColor === 'white' ? longest.game.black.name : longest.game.white.name,
      },
      score: longest.record.plies.length / Math.max(1, medianLen),
    })
  }

  // Most-faced opponent: distinctive when one name recurs.
  const faced = new Map<string, number>()
  for (const g of userGames) {
    const opp = g.userColor === 'white' ? g.game.black.name : g.game.white.name
    if (opp && opp !== '?') faced.set(opp, (faced.get(opp) ?? 0) + 1)
  }
  const topFaced = [...faced.entries()].sort(([, a], [, b]) => b - a)[0]
  if (topFaced && topFaced[1] >= 3) {
    candidates.push({ d: { kind: 'most-faced', opponent: topFaced[0], count: topFaced[1] }, score: topFaced[1] })
  }

  // Most-blundered-on square: the destination square the user hangs pieces on.
  const blunderSquares = new Map<string, number>()
  for (const m of allMoves) {
    if (m.classification === 'blunder' && m.played.length >= 4) {
      const sq = m.played.slice(2, 4)
      blunderSquares.set(sq, (blunderSquares.get(sq) ?? 0) + 1)
    }
  }
  const topSquare = [...blunderSquares.entries()].sort(([, a], [, b]) => b - a)[0]
  if (topSquare && topSquare[1] >= 3) {
    candidates.push({ d: { kind: 'blundered-square', square: topSquare[0], count: topSquare[1] }, score: topSquare[1] })
  }

  // Favorite piece to move, EXCLUDING pawns: everyone moves pawns most, so
  // "you love pawns" is never distinctive. A queen- or knight-mover is.
  const pieceCounts = new Map<string, number>()
  for (const g of userGames) {
    for (const p of movedPieces(g)) {
      if (p === 'p') continue
      pieceCounts.set(p, (pieceCounts.get(p) ?? 0) + 1)
    }
  }
  const totalPieceMoves = [...pieceCounts.values()].reduce((a, b) => a + b, 0)
  const topPiece = [...pieceCounts.entries()].sort(([, a], [, b]) => b - a)[0]
  if (topPiece && totalPieceMoves >= 20 && topPiece[1] / totalPieceMoves >= 0.35) {
    candidates.push({
      d: { kind: 'favorite-piece', piece: PIECE_NAMES[topPiece[0]] ?? topPiece[0], count: topPiece[1] },
      score: (topPiece[1] / totalPieceMoves) * 8,
    })
  }

  // Comebacks: games the user was losing (reached < 20% win) then won.
  let comebacks = 0
  for (const g of userGames) {
    const ms = userMoves(g)
    if (ms[0]?.won && ms.some((m) => m.wpBefore < 20 || m.wpAfter < 20)) comebacks += 1
  }
  if (comebacks >= 2) candidates.push({ d: { kind: 'comebacks', count: comebacks }, score: comebacks * 2 })

  if (!candidates.length) return null
  return candidates.sort((a, b) => b.score - a.score)[0].d
}
