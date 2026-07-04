import { Chess, castlingSide, normalizeMove } from 'chessops/chess'
import { parsePgn } from 'chessops/pgn'
import { parseSan } from 'chessops/san'
import { makeUci, parseUci } from 'chessops/util'
import type { Move } from 'chessops/types'
import { matchOpening } from './openings.js'

// chessops represents castling as king-takes-rook (e1h1); engines and the
// rest of this system speak standard UCI (e1g1). All stored move lists use
// standard UCI. scripts/build-openings.mjs applies the same conversion so
// book keys and game move lists always agree.
export function standardUci(pos: Chess, move: Move): string {
  const side = castlingSide(pos, move)
  if (side && 'from' in move) {
    return makeUci({ from: move.from, to: (move.from & ~7) | (side === 'h' ? 6 : 2) })
  }
  return makeUci(move)
}

const STANDARD_FEN_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq'
const CLK_RE = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/

export type PgnRejectionCode = 'empty' | 'variant' | 'illegal-move' | 'too-short'

export interface PgnRejection {
  ok: false
  code: PgnRejectionCode
  message: string
}

export interface ParsedGame {
  ok: true
  uciMoves: string[]
  clocks: (number | null)[]
  white: { name: string; rating: number | null }
  black: { name: string; rating: number | null }
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  timeControl: string
  date: string | null
  eco: string | null
  openingName: string | null
  terminal: 'checkmate' | 'stalemate' | null
}

function rating(v: string | undefined): number | null {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : null
}

// Parses one game's PGN into a clean UCI move list plus game-record fields.
// Comments, NAGs, and variations are stripped; %clk values are extracted per
// ply. Rejected with a per-game error: variant games (Chess960 or any custom
// starting position), corrupted or illegal-move games, and games under 6 plies.
export function parseGamePgn(text: string): ParsedGame | PgnRejection {
  const games = parsePgn(text)
  const game = games[0]
  if (!game) return { ok: false, code: 'empty', message: 'No game found in PGN.' }

  const headers = game.headers
  const variant = headers.get('Variant')
  if (variant && variant.toLowerCase() !== 'standard') {
    return { ok: false, code: 'variant', message: `Variant games (${variant}) are not supported.` }
  }
  const fen = headers.get('FEN')
  if (fen && !fen.startsWith(STANDARD_FEN_BOARD)) {
    return { ok: false, code: 'variant', message: 'Games from a custom starting position are not supported.' }
  }

  const pos = Chess.default()
  const uciMoves: string[] = []
  const clocks: (number | null)[] = []
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san)
    if (!move) {
      return {
        ok: false,
        code: 'illegal-move',
        message: `Illegal or unreadable move "${node.san}" at ply ${uciMoves.length + 1}.`,
      }
    }
    uciMoves.push(standardUci(pos, move))
    pos.play(move)
    const clk = (node.comments ?? []).map((c) => CLK_RE.exec(c)).find(Boolean)
    clocks.push(clk ? Number(clk[1]) * 3600 + Number(clk[2]) * 60 + Number(clk[3]) : null)
  }

  if (uciMoves.length < 6) {
    return { ok: false, code: 'too-short', message: `Game has only ${uciMoves.length} plies; minimum is 6.` }
  }

  const resultHeader = headers.get('Result')
  const result =
    resultHeader === '1-0' || resultHeader === '0-1' || resultHeader === '1/2-1/2' ? resultHeader : '*'
  const dateHeader = headers.get('UTCDate') ?? headers.get('Date')
  const date = dateHeader && /^\d{4}\.\d{2}\.\d{2}$/.test(dateHeader) ? dateHeader.replaceAll('.', '-') : null
  const opening = matchOpening(uciMoves)

  return {
    ok: true,
    uciMoves,
    clocks,
    white: { name: headers.get('White') ?? '?', rating: rating(headers.get('WhiteElo')) },
    black: { name: headers.get('Black') ?? '?', rating: rating(headers.get('BlackElo')) },
    result,
    timeControl: headers.get('TimeControl') ?? '?',
    date,
    eco: opening?.eco ?? null,
    openingName: opening?.name ?? null,
    terminal: pos.isCheckmate() ? 'checkmate' : pos.isStalemate() ? 'stalemate' : null,
  }
}

// Replays a UCI move list from the standard start, throwing on any illegal
// move, and reports whether the final position ended the game.
export function finalStatus(uciMoves: readonly string[]): 'checkmate' | 'stalemate' | null {
  const pos = Chess.default()
  for (const [i, u] of uciMoves.entries()) {
    const raw = parseUci(u)
    // normalizeMove converts standard-UCI castling (e1g1) back to the
    // king-takes-rook form chessops uses internally.
    const move = raw && normalizeMove(pos, raw)
    if (!move || !pos.isLegal(move)) throw new Error(`illegal uci move "${u}" at ply ${i + 1}`)
    pos.play(move)
  }
  return pos.isCheckmate() ? 'checkmate' : pos.isStalemate() ? 'stalemate' : null
}
