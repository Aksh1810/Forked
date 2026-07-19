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

// Re-pinned for the chess.com-calibrated bands (inaccuracy>=4/mistake>=7.5/
// blunder>=25, excellent<2/good<4) with decided-position suppression
// deleted entirely. Recomputed with an independent scratch reimplementation
// of classifyWinPctSwing/enrichClassifications (not by running this suite
// and copying its output). The notable change from the pre-calibration pins
// is ply 8: it used to read 'great' because wpBefore rounded to 90.009%,
// just over the old decided-position cutoff of 90, so classifyWinPctSwing
// suppressed to 'none' and the played-best/prevLoss>=20 'great' path won by
// default. With suppression deleted, ply 8's loss (10.0381, wpBefore 90.009
// -> wpAfter 79.971) is a plain 'mistake' swing, and prevLoss (ply 7's
// 42.033-pt blunder) >=7.5 with wpBefore>=70 fires the miss-relabel branch
// first, so ply 8 now reads 'miss' instead of 'great' — the swing branch is
// checked before the played-best branch, so removing suppression changes
// which branch gets there first, not just the swing's own threshold.
test('golden record: enrichClassifications output is pinned', () => {
  expect(enrichClassifications(record)).toEqual([
    'book', 'book', 'book', 'book',
    'best', 'best',
    'blunder', 'miss',
    'best', 'inaccuracy',
    'best', 'excellent',
  ])
})

test('golden record: turningPoint is pinned', () => {
  expect(turningPoint(record)).toBe(7)
})

// Re-pinned for the new curve (180*exp(-0.05x)-80, clamp point ~16.22
// win-pts) and the gameAccuracies blend (15% best-move rate, 85% mean move
// accuracy, with a stretch below 62 — see accuracy.ts).
// White's 6 moves (plies 1,3,5,7,9,11): book, book, quiet gain (acc 100),
// ply 7's own 42.033-pt blunder (past the clamp, acc 0), quiet gain (100),
// quiet gain (100). White accs = [100, 100, 100, 0, 100, 100] -> meanAcc
// 500/6 = 83.3333. Of the 4 non-book white plies (5,7,9,11), 3 play the
// best move (7's stored blunder does not) -> bestPct = 75. raw = 0.15*75 +
// 0.85*83.3333 = 82.0833, no stretch (>=62) -> white = 82.0833.
// Black's 6 moves (plies 2,4,6,8,10,12): book, book, quiet gain (100),
// ply 8's 10.0381-pt loss (180*exp(-0.05*10.0381)-80 = 28.9677), ply 10's
// 4.9834-pt loss (180*exp(-0.05*4.9834)-80 = 60.3005), quiet gain (100).
// Black accs = [100, 100, 100, 28.9677, 60.3005, 100] -> meanAcc
// 489.2682/6 = 81.5447. Of the 4 non-book black plies (6,8,10,12), 2 play
// the best move (6,8 do; 10,12 don't) -> bestPct = 50. raw = 0.15*50 +
// 0.85*81.5447 = 76.8130, no stretch -> black = 76.8130.
test('golden record: gameAccuracies is pinned', () => {
  const acc = gameAccuracies(record, null)
  expect(acc.white).toBeCloseTo(82.0833, 2)
  expect(acc.black).toBeCloseTo(76.8130, 2)
})
