import { Chess, normalizeMove } from 'chessops/chess'
import { parseSquare, parseUci } from 'chessops/util'
import type { Role } from 'chessops/types'
import type { Classification, Eval, EngineRecord } from './schemas.js'
import { moverWinPct } from './win.js'

// Classification is based on the mover's win-probability swing, in percentage
// points: a loss of 30 or more is a blunder, 20 or more a mistake, 10 or more
// an inaccuracy. In already-decided positions (mover below 10 or above 90
// before the move) classification is suppressed, EXCEPT when the move crosses
// from 60 or above down to 40 or below, which throws away a winning position
// and is always flagged.
export function classifyWinPctSwing(wpBefore: number, wpAfter: number): Classification {
  const throwAway = wpBefore >= 60 && wpAfter <= 40
  const decided = wpBefore < 10 || wpBefore > 90
  if (decided && !throwAway) return 'none'
  const loss = wpBefore - wpAfter
  if (loss >= 30) return 'blunder'
  if (loss >= 20) return 'mistake'
  if (loss >= 10) return 'inaccuracy'
  return 'none'
}

// Live (browser-engine) per-move tier for user-played moves: the subset of
// enrichClassifications computable from ONE eval pair. No book detection, no
// sacrifice/great heuristics, no miss-relabel (those need mainline context).
// ponytail: 'brilliant'/'great'/'miss'/'book' unreachable here by design.
export function classifyLive(
  before: Eval,
  after: Eval,
  mover: 'white' | 'black',
  playedBest: boolean,
): Enriched {
  if (playedBest) return 'best'
  const wpBefore = moverWinPct(before, mover)
  const wpAfter = moverWinPct(after, mover)
  const loss = wpBefore - wpAfter
  const base = classifyWinPctSwing(wpBefore, wpAfter)
  // Same blunder gate as enrichClassifications: only catastrophic keeps it.
  if (base === 'blunder' && !mateAgainstMover(after, mover) && loss < 40 && wpAfter > 15) {
    return 'mistake'
  }
  if (base !== 'none') return base
  if (loss < 2) return 'excellent'
  if (loss < 10) return 'good'
  return 'none'
}

// The presentation-layer tier set (chess.com-style). Derived from the stored
// EngineRecord at render time — never persisted, never re-analyzed. Stored
// `classification` remains the source of truth for insights/aggregates; this
// is strictly a richer label for display.
export type Enriched =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'none'

const PIECE_VALUE: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 99,
}

function pieceValue(role: Role | undefined): number {
  return role ? PIECE_VALUE[role] : 0
}

// Eval mate sign is always White-perspective (positive: White mates,
// negative: Black mates) — see schemas.ts. These read it from a mover's
// point of view; null (no mate stored, or a terminal ply) is never a mate.
function mateForMover(ev: Eval | null, mover: 'white' | 'black'): boolean {
  return ev !== null && ev.type === 'mate' && (mover === 'white' ? ev.value > 0 : ev.value < 0)
}

function mateAgainstMover(ev: Eval | null, mover: 'white' | 'black'): boolean {
  return ev !== null && ev.type === 'mate' && (mover === 'white' ? ev.value < 0 : ev.value > 0)
}

// One tier per ply, in order. Rule order matters (first match wins):
// book -> stored bad tier (relabeled to 'miss' when it threw away an
// opponent blunder) -> played-the-best-move (brilliant/great/best) ->
// excellent/good/none by win-pct loss.
//
// ponytail: no static-exchange evaluation and no true "only move" detection
// (MultiPV line 2 is discarded at analysis time, uci.ts) — the sacrifice and
// "great" heuristics below are approximations, not engine-verified facts.
export function enrichClassifications(record: EngineRecord): Enriched[] {
  const pos = Chess.default()
  const out: Enriched[] = []
  let before = record.startEval
  let prevLoss = 0
  for (const p of record.plies) {
    const mover = p.ply % 2 === 1 ? 'white' : 'black'
    const wpBefore = moverWinPct(before, mover)
    // evalAfter is null only for a game-ending ply; a stalemate is scored as
    // 100 same as mate here (label-only impact — this feeds tiers, not the
    // stored classification or accuracy numbers).
    const wpAfter = p.evalAfter === null ? 100 : moverWinPct(p.evalAfter, mover)
    const loss = wpBefore - wpAfter

    // Board state BEFORE this ply's move, for the sacrifice heuristic.
    const fromSq = parseSquare(p.played.slice(0, 2))
    const toSq = parseSquare(p.played.slice(2, 4))
    const fromRole = fromSq !== undefined ? pos.board.getRole(fromSq) : undefined
    const destRole = toSq !== undefined ? pos.board.getRole(toSq) : undefined
    const movedValue = pieceValue(fromRole)
    // En passant: a pawn capture where the destination square reads empty
    // (the captured pawn sits beside it, not on it) — without this the board
    // lookup above sees no capture at all and the sac heuristic below reads
    // an even pawn trade as "gave up a pawn for nothing".
    const enPassant = fromRole === 'pawn' && p.played[0] !== p.played[2] && !destRole
    const capturedValue = enPassant ? PIECE_VALUE.pawn : pieceValue(destRole)

    let tier: Enriched
    if (p.book) {
      tier = 'book'
    } else if (p.classification !== 'none') {
      // Relabel: the opponent just handed the mover a big edge (>=20 win-pts)
      // and the mover was still comfortably ahead (>=70) going into this
      // move — a miss, not just a mistake/inaccuracy/blunder.
      tier = prevLoss >= 20 && wpBefore >= 70 ? 'miss' : p.classification
      // Blunder gate (chess.com classification-v2 style): a stored 'blunder'
      // keeps that display tier only when it's catastrophic — otherwise it
      // reads as a plain mistake. ponytail: win%-swing + terminal signals
      // only, no material-hang/SEE detection to size the actual damage.
      if (tier === 'blunder' && !mateAgainstMover(p.evalAfter, mover) && loss < 40 && wpAfter > 15) {
        tier = 'mistake'
      }
    } else if (p.played === p.best) {
      // Sacrifice: the opponent's expected reply (pv[1]) recaptures right
      // where the mover just landed, and the mover gave up more than they
      // took. Promotions (5-char uci) are excluded entirely — movedValue
      // reads the pawn that moved, not the piece it became, which reads any
      // promotion the opponent can capture back as a "sacrifice".
      const isPromotion = p.played.length === 5
      const sac =
        !isPromotion &&
        p.pv[1] !== undefined &&
        p.pv[1].slice(2, 4) === p.played.slice(2, 4) &&
        movedValue > capturedValue
      if (sac && wpBefore < 95 && wpAfter >= 40) tier = 'brilliant'
      else if (prevLoss >= 20) tier = 'great' // found the punish for the opponent's previous blunder
      else tier = 'best'
    } else if (loss < 2) {
      tier = 'excellent'
    } else if (loss < 10) {
      tier = 'good'
    } else {
      tier = 'none'
    }
    out.push(tier)

    prevLoss = loss
    if (p.evalAfter !== null) before = p.evalAfter

    // Advance the replay for the next ply's piece lookups. Unreplayable data
    // shouldn't happen (this move list already replayed cleanly at ingest);
    // silently stop advancing rather than throwing, matching sanMoves/pgn.ts.
    const raw = parseUci(p.played)
    const move = raw && normalizeMove(pos, raw)
    if (move && pos.isLegal(move)) pos.play(move)
  }
  return out
}

// The ply with the single largest mover win%-loss, i.e. the moment that did
// the most damage to whoever was on move. Same eval-chain walk as
// enrichClassifications (terminal evalAfter null scores as 100 for the
// mover), but no tier/book/sacrifice logic — this only cares about the size
// of the swing. Below a ~20-point loss the game never really turned; return
// null rather than pointing at a routine wobble.
export function turningPoint(record: EngineRecord): number | null {
  let before = record.startEval
  let bestPly: number | null = null
  let bestLoss = -Infinity
  for (const p of record.plies) {
    const mover = p.ply % 2 === 1 ? 'white' : 'black'
    const wpBefore = moverWinPct(before, mover)
    const wpAfter = p.evalAfter === null ? 100 : moverWinPct(p.evalAfter, mover)
    const loss = wpBefore - wpAfter
    if (loss > bestLoss) {
      bestLoss = loss
      bestPly = p.ply
    }
    if (p.evalAfter !== null) before = p.evalAfter
  }
  return bestLoss >= 20 ? bestPly : null
}

// Structured reason for a ply's coach motif sentence. This is DATA, not
// prose — the web layer (copy.ts templates) turns it into the actual
// sentence, per the "all user-facing strings live in copy.ts" rule.
export type Motif =
  | { kind: 'allowed-mate'; n: number }
  | { kind: 'missed-mate'; n: number }
  | { kind: 'hung-piece'; piece: Role }
  | { kind: 'best-capture'; piece: Role; square: string }

const BAD_TIERS = new Set<Enriched>(['inaccuracy', 'mistake', 'miss', 'blunder'])

// One motif per ply (or null), first match wins:
//  - 'allowed-mate': this move allows a forced mate against the mover.
//  - 'missed-mate': the mover had a forced mate before this move, didn't
//    play the best move, and this move didn't still deliver mate.
//  - 'hung-piece': the opponent's ACTUAL next move (record.uciMoves[p.ply])
//    recaptures on the square this move just landed on, and the tier here is
//    mistake/miss/blunder.
//  - 'best-capture': the best move was a capture and the tier here is a bad
//    one (inaccuracy/mistake/miss/blunder) — a winning capture was on offer.
// Same chessops incremental-replay pattern as enrichClassifications.
// ponytail: pattern matching over stored eval/move data, not a tactical
// detector — no SEE, no verification a "hang" or "capture" line was forced.
export function moveMotif(record: EngineRecord, enriched: Enriched[]): (Motif | null)[] {
  const pos = Chess.default()
  let before: Eval = record.startEval
  return record.plies.map((p, i) => {
    const mover = p.ply % 2 === 1 ? 'white' : 'black'
    const tier = enriched[i] ?? 'none'

    // Board state BEFORE this ply's move: does the best move capture something?
    const bestToSq = parseSquare(p.best.slice(2, 4))
    const bestCaptured = bestToSq !== undefined ? pos.board.getRole(bestToSq) : undefined

    let motif: Motif | null = null
    // "Allows mate" only when this move NEWLY allows it — if the mover was
    // already getting mated before the move, nothing was allowed here.
    if (
      p.evalAfter !== null &&
      p.evalAfter.type === 'mate' &&
      mateAgainstMover(p.evalAfter, mover) &&
      !mateAgainstMover(before, mover)
    ) {
      motif = { kind: 'allowed-mate', n: Math.abs(p.evalAfter.value) }
    } else if (
      before.type === 'mate' &&
      mateForMover(before, mover) &&
      p.played !== p.best &&
      !(p.evalAfter !== null && p.evalAfter.type === 'mate' && mateForMover(p.evalAfter, mover))
    ) {
      motif = { kind: 'missed-mate', n: Math.abs(before.value) }
    }

    // Advance the replay so the hung-piece check below can see the piece now
    // sitting on the played move's destination square.
    const raw = parseUci(p.played)
    const move = raw && normalizeMove(pos, raw)
    if (move && pos.isLegal(move)) pos.play(move)

    if (!motif) {
      const reply = record.uciMoves[p.ply] // opponent's ACTUAL next move, if any
      const destSq = parseSquare(p.played.slice(2, 4))
      const hungRole = destSq !== undefined ? pos.board.getRole(destSq) : undefined
      if (
        reply &&
        hungRole &&
        reply.slice(2, 4) === p.played.slice(2, 4) &&
        (tier === 'mistake' || tier === 'miss' || tier === 'blunder')
      ) {
        motif = { kind: 'hung-piece', piece: hungRole }
      } else if (bestCaptured && BAD_TIERS.has(tier)) {
        motif = { kind: 'best-capture', piece: bestCaptured, square: p.best.slice(2, 4) }
      }
    }

    if (p.evalAfter !== null) before = p.evalAfter
    return motif
  })
}
