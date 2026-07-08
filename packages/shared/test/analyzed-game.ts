import type { AnalyzedGame } from '../src/insights.js'
import type { Classification, Eval, PlyAnalysis } from '../src/schemas.js'

// Builds a synthetic AnalyzedGame from a real (legal) move list. Per-ply
// overrides control classification, evalAfter, and book flag; everything else
// defaults to a quiet cp-0 position so a test only sets what it asserts on.
export function mkGame(opts: {
  gameId: string
  uciMoves: string[]
  userColor: 'white' | 'black' | null
  result?: '1-0' | '0-1' | '1/2-1/2' | '*'
  date?: string | null
  clocks?: (number | null)[]
  white?: string
  black?: string
  eco?: string | null
  openingName?: string | null
  plies?: Record<number, { classification?: Classification; evalAfter?: Eval | null; book?: boolean }>
}): AnalyzedGame {
  const { uciMoves } = opts
  const overrides = opts.plies ?? {}
  const plies: PlyAnalysis[] = uciMoves.map((played, i) => {
    const ply = i + 1
    const o = overrides[ply] ?? {}
    return {
      ply,
      played,
      best: played,
      pv: [],
      evalAfter: o.evalAfter === undefined ? { type: 'cp', value: 0 } : o.evalAfter,
      classification: o.classification ?? 'none',
      book: o.book ?? false,
    }
  })
  const cacheKey = `test-${opts.gameId}`
  return {
    gameId: opts.gameId,
    userColor: opts.userColor,
    game: {
      gameId: opts.gameId,
      white: { name: opts.white ?? 'white_player', rating: null },
      black: { name: opts.black ?? 'black_player', rating: null },
      timeControl: '600',
      result: opts.result ?? '*',
      date: opts.date === undefined ? '2026-06-01' : opts.date,
      clocks: opts.clocks ?? uciMoves.map(() => null),
      eco: opts.eco ?? null,
      openingName: opts.openingName ?? null,
      cacheKey,
    },
    record: {
      cacheKey,
      engineVersion: 'Stockfish 18',
      nodeBudget: 100_000,
      uciMoves,
      startEval: { type: 'cp', value: 0 },
      plies,
    },
  }
}

// A real, legal 12-ply Italian game line, useful when a test needs a game the
// move-replaying insight functions can walk without ending early.
export const ITALIAN = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5',
  'c2c3', 'g8f6', 'd2d3', 'd7d6', 'b1d2', 'e8g8',
]

// Scholar's mate: Black's 6th ply (g8f6) walks into Qxf7#.
export const SCHOLARS = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']
