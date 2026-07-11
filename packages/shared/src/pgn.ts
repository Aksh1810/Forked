import { Chess, castlingSide, normalizeMove } from 'chessops/chess'
import { parsePgn, type Game, type PgnNodeData } from 'chessops/pgn'
import { makeSanAndPlay, parseSan } from 'chessops/san'
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

export type PgnRejectionCode = 'empty' | 'variant' | 'illegal-move' | 'too-short' | 'too-long'

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

// Hard ceiling on game length. The longest serious recorded games sit around
// 550 plies; anything past this is a pasted-PGN denial-of-service attempt (one
// enormous game would pin a worker for hours, its lease heartbeat dutifully
// extending the whole time), not chess.
const MAX_PLIES = 600

function rating(v: string | undefined): number | null {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : null
}

// chess.com occasionally sends a player name as the literal string "undefined"
// (closed accounts, some bots). Normalize those and blanks to a stable
// placeholder so the UI never says "against undefined". Length-capped: header
// values are attacker-supplied on the PGN-paste path and get stored in game
// records; chess.com usernames max out around 25 characters.
function playerName(v: string | undefined): string {
  const n = v?.trim().slice(0, 60)
  return n && n !== 'undefined' ? n : '?'
}

// Parses one game's PGN into a clean UCI move list plus game-record fields.
// Comments, NAGs, and variations are stripped; %clk values are extracted per
// ply. Rejected with a per-game error: variant games (Chess960 or any custom
// starting position), corrupted or illegal-move games, and games under 6 plies.
export function parseGamePgn(text: string): ParsedGame | PgnRejection {
  const games = parsePgn(text)
  const game = games[0]
  if (!game) return { ok: false, code: 'empty', message: 'No game found in PGN.' }
  return parseGame(game)
}

// Multi-game PGN paste: each game in the text parses or rejects on its own.
export function parseAllGamesPgn(text: string): (ParsedGame | PgnRejection)[] {
  return parsePgn(text).map(parseGame)
}

function parseGame(game: Game<PgnNodeData>): ParsedGame | PgnRejection {
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
    if (uciMoves.length >= MAX_PLIES) {
      return { ok: false, code: 'too-long', message: `Game exceeds ${MAX_PLIES} plies.` }
    }
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
    white: { name: playerName(headers.get('White')), rating: rating(headers.get('WhiteElo')) },
    black: { name: playerName(headers.get('Black')), rating: rating(headers.get('BlackElo')) },
    result,
    timeControl: (headers.get('TimeControl') ?? '?').slice(0, 32),
    date,
    eco: opening?.eco ?? null,
    openingName: opening?.name ?? null,
    terminal: pos.isCheckmate() ? 'checkmate' : pos.isStalemate() ? 'stalemate' : null,
  }
}

// Replays `prefix` then `uciMoves` from the standard start and returns the SAN
// for each of `uciMoves` (not `prefix`). Same replay pattern as `finalStatus`
// and `fenBeforePly`: parseUci + normalizeMove so standard-UCI castling
// (e1g1) round-trips through chessops' king-takes-rook internal form. Used
// for both the game move list (`sanMoves(record.uciMoves)`) and a PV line
// (`sanMoves(p.pv, record.uciMoves.slice(0, p.ply - 1))`). An unreplayable
// move (shouldn't happen; these lists already replayed cleanly at ingest)
// stops the walk and returns whatever SANs were produced so far.
export function sanMoves(uciMoves: readonly string[], prefix: readonly string[] = []): string[] {
  const pos = Chess.default()
  for (const u of prefix) {
    const raw = parseUci(u)
    const move = raw && normalizeMove(pos, raw)
    if (!move || !pos.isLegal(move)) return []
    pos.play(move)
  }
  const out: string[] = []
  for (const u of uciMoves) {
    const raw = parseUci(u)
    const move = raw && normalizeMove(pos, raw)
    if (!move || !pos.isLegal(move)) break
    out.push(makeSanAndPlay(pos, move))
  }
  return out
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
