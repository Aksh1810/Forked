import { expect, test } from 'vitest'
import { enrichClassifications, turningPoint } from '../src/classify.js'
import { gameAccuracies } from '../src/accuracy.js'
import { winPctFromCp } from '../src/win.js'
import type { Eval, EngineRecord, PlyAnalysis } from '../src/schemas.js'

// Golden-record determinism test: one fixed synthetic EngineRecord, output
// pinned exactly. Purpose is a tripwire, not a spec — if this fails, either
// classify.ts/accuracy.ts changed on purpose (re-pin) or by accident (fix it).
//
// Real, legal Evans Gambit moves (1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4 Bxb4
// 5.c3 Ba5 6.d4 exd4) so the chessops replay inside enrichClassifications has
// a real position to walk — but the evals/classifications/best moves below
// are entirely synthetic, chosen to exercise: a book prefix, a severe
// stored blunder that survives the blunder gate, and black's reply (best
// move, prevLoss >= 20) getting the 'great' punish tier.

// cpForWhiteWinPct: binary search to hit an exact white win% target, so the
// win-pct swings driving every tier decision below are round numbers.
function cpForWhiteWinPct(target: number): number {
  let lo = -3000
  let hi = 3000
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (winPctFromCp(mid) < target) lo = mid
    else hi = mid
  }
  return Math.round((lo + hi) / 2)
}
const w = (whitePct: number): Eval => ({ type: 'cp', value: cpForWhiteWinPct(whitePct) })

const UCI = [
  'e2e4', 'e7e5', // 1
  'g1f3', 'b8c6', // 2
  'f1c4', 'f8c5', // 3
  'b2b4', 'c5b4', // 4
  'c2c3', 'b4a5', // 5
  'd2d4', 'e5d4', // 6
]

// White win% after each ply (index 0 = start eval).
const W = [50, 55, 50, 55, 50, 58, 52, 10, 20, 25, 30, 35, 25]

function mkPly(i: number, overrides: Partial<PlyAnalysis> = {}): PlyAnalysis {
  const played = UCI[i]
  return {
    ply: i + 1,
    played,
    best: played,
    pv: [played],
    evalAfter: w(W[i + 1]),
    classification: 'none',
    book: false,
    ...overrides,
  }
}

const record: EngineRecord = {
  cacheKey: 'golden',
  engineVersion: 'Stockfish 18',
  nodeBudget: 100_000,
  uciMoves: UCI,
  startEval: w(W[0]),
  plies: [
    mkPly(0, { book: true }), // 1. e4
    mkPly(1, { book: true }), // 1... e5
    mkPly(2, { book: true }), // 2. Nf3
    mkPly(3, { book: true }), // 2... Nc6
    mkPly(4), // 3. Bc4 - quiet best
    mkPly(5), // 3... Bc5 - quiet best
    mkPly(6, { best: 'd2d3', pv: ['d2d3'], classification: 'blunder' }), // 4. b4?? severe stored blunder
    mkPly(7), // 4... Bxb4 - the punish: best move right after a >=20 mover loss -> 'great'
    mkPly(8), // 5. c3 - quiet best
    mkPly(9, { best: 'd7d6', pv: ['d7d6'] }), // 5... Ba5 - not best, moderate loss -> 'good'
    mkPly(10), // 6. d4 - quiet best
    mkPly(11, { best: 'd7d6', pv: ['d7d6'], classification: 'inaccuracy' }), // 6... exd4 - stored inaccuracy
  ],
}

// Re-pinned for the WintrChess bands (F2: inaccuracy>=8/mistake>=12/blunder>=22,
// excellent<4.5/good<8) and F3 (tier derived from the recomputed swing, not
// p.classification). Recomputed with an independent scratch reimplementation
// of classifyWinPctSwing/enrichClassifications (not by running this suite and
// copying its output) — the notable change from the old pins is ply 12
// ('inaccuracy' -> 'excellent'): its evalAfter is actually a 10-pt GAIN
// (64.99% -> 74.98%) for white, so the swing is 'none' regardless of bands;
// only F3's move from a trusted stale p.classification override ('inaccuracy'
// in the fixture) to the recomputed swing changes what shows up here — ply 8
// ('great') is unaffected: wpBefore there rounds to 90.009% (just over the
// decided-position cutoff of 90), so classifyWinPctSwing still suppresses to
// 'none' and the played-best/prevLoss>=20 'great' path still wins.
test('golden record: enrichClassifications output is pinned', () => {
  expect(enrichClassifications(record)).toEqual([
    'book', 'book', 'book', 'book',
    'best', 'best',
    'blunder', 'great',
    'best', 'good',
    'best', 'excellent',
  ])
})

test('golden record: turningPoint is pinned', () => {
  expect(turningPoint(record)).toBe(7)
})

// Re-pinned for F1 (per-move accuracy then plain mean, book plies at 100
// instead of excluded). Both numbers rise sharply from the old pins (62.12 /
// 84.44) mainly because the 4 leading book plies now score 100 each instead
// of being dropped from the average entirely.
test('golden record: gameAccuracies is pinned', () => {
  const acc = gameAccuracies(record, null)
  expect(acc.white).toBeCloseTo(86.0002, 3)
  expect(acc.black).toBeCloseTo(91.2002, 3)
})
