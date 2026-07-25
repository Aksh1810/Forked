import { Chess, normalizeMove } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { parseUci } from 'chessops/util'
import { gameAccuracies } from './accuracy.js'
import { openingFamily } from './aggregates.js'
import { gamePhases, type GamePhase } from './phases.js'
import { matchOpening } from './openings.js'
import { finalStatus } from './pgn.js'
import { outcomeFor } from './player.js'
import { sideToMove } from './uci.js'
import type { EngineRecord, GameRecord } from './schemas.js'
import { moverWinPct } from './win.js'

// One analyzed game: the game record joined with its engine record. This is
// the finalizer's input. userColor null means a PGN paste with no matched
// player; such games contribute to nothing user-specific.
export interface AnalyzedGame {
  gameId: string
  userColor: 'white' | 'black' | null
  game: GameRecord
  record: EngineRecord
}

// One of the user's own non-book moves, enriched with everything the insight
// functions need. Book moves are excluded up front, matching classification.
export interface UserMove {
  gameId: string
  ply: number
  phase: GamePhase
  played: string
  best: string
  lossPct: number
  wpBefore: number
  wpAfter: number
  classification: EngineRecord['plies'][number]['classification']
  clockAfter: number | null
  date: string | null
  family: string
  opponent: string
  won: boolean
  lost: boolean
}

// Replays the move list to the position BEFORE ply p (1-indexed) and returns
// its FEN, for board diagrams on the flex and worst-blunder slides. Falls back
// to the start position if a stored move is unreplayable (should not happen;
// the same list already replayed cleanly at ingest).
export function fenBeforePly(uciMoves: readonly string[], ply: number): string {
  const pos = Chess.default()
  for (let i = 0; i < ply - 1 && i < uciMoves.length; i++) {
    const raw = parseUci(uciMoves[i])
    const move = raw && normalizeMove(pos, raw)
    if (!move || !pos.isLegal(move)) break
    pos.play(move)
  }
  return makeFen(pos.toSetup())
}

function opponentName(g: AnalyzedGame): string {
  if (g.userColor === 'white') return g.game.black.name
  if (g.userColor === 'black') return g.game.white.name
  return g.game.black.name
}

// The one walk every insight is built from: opening match, phases, terminal
// status, opening family, opponent, the user's own non-book moves, and this
// game's accuracies — each computed exactly once. Memoized per AnalyzedGame in
// a module-level WeakMap: callers (insights.ts, archetype.ts, delighter.ts)
// pass the same AnalyzedGame objects around within one buildWrappedSummary
// call, the walk is a pure function of that object, so the cache can never go
// stale — and a WeakMap key means a finished job's games are still
// garbage-collectable once nothing else references them.
export interface GameWalk {
  bookPlies: number
  phases: GamePhase[]
  terminal: ReturnType<typeof finalStatus>
  family: string
  opponent: string
  moves: UserMove[] // the user's own non-book moves
  accuracies: ReturnType<typeof gameAccuracies>
  // White-perspective win% across the whole game: startEval, then one entry
  // per ply carrying the last non-null eval forward (length = plies + 1).
  // Feeds the worst-blunder cliff sparkline.
  whiteWinSeries: number[]
}

const cache = new WeakMap<AnalyzedGame, GameWalk>()

export function walkGame(g: AnalyzedGame): GameWalk {
  const cached = cache.get(g)
  if (cached) return cached

  const bookPlies = matchOpening(g.record.uciMoves)?.plies ?? 0
  const phases = gamePhases(g.record.uciMoves, bookPlies)
  const terminal = finalStatus(g.record.uciMoves)
  const family = openingFamily(g.game.eco, g.game.openingName)
  const opponent = opponentName(g)
  const accuracies = gameAccuracies(g.record, terminal)

  // Whole-game White-perspective win% series, independent of who the user is,
  // so it is well-defined even for a userColor-less pasted game.
  let ev = g.record.startEval
  const whiteWinSeries: number[] = [moverWinPct(ev, 'white')]
  for (const p of g.record.plies) {
    if (p.evalAfter !== null) ev = p.evalAfter
    whiteWinSeries.push(moverWinPct(ev, 'white'))
  }

  const moves: UserMove[] = []
  if (g.userColor) {
    const outcome = outcomeFor(g.game.result, g.userColor)
    const won = outcome === 'w'
    const lost = outcome === 'l'
    let before = g.record.startEval
    for (const p of g.record.plies) {
      const mover = sideToMove(p.ply - 1)
      const wpBefore = moverWinPct(before, mover)
      const wpAfter =
        p.evalAfter === null
          ? terminal === 'checkmate'
            ? 100
            : 50
          : moverWinPct(p.evalAfter, mover)
      if (p.evalAfter !== null) before = p.evalAfter
      if (mover !== g.userColor || p.book) continue
      moves.push({
        gameId: g.gameId,
        ply: p.ply,
        phase: phases[p.ply - 1],
        played: p.played,
        best: p.best,
        lossPct: Math.max(0, wpBefore - wpAfter),
        wpBefore,
        wpAfter,
        classification: p.classification,
        clockAfter: g.game.clocks[p.ply - 1] ?? null,
        date: g.game.date,
        family,
        opponent,
        won,
        lost,
      })
    }
  }

  const walk: GameWalk = { bookPlies, phases, terminal, family, opponent, moves, accuracies, whiteWinSeries }
  cache.set(g, walk)
  return walk
}

// The user's own non-book moves across one game, each carrying its
// win-probability loss, phase, clock, and outcome context. This single walk
// is the basis of every downstream insight.
export function userMoves(g: AnalyzedGame): UserMove[] {
  return walkGame(g).moves
}
