import { expect, test } from 'vitest'
import { moveAccuracyPct, gameAccuracies, phaseAccuracies } from '../src/accuracy.js'
import type { PlyAnalysis } from '../src/schemas.js'
import { winPctFromCp } from '../src/win.js'

// A real, legal 18-ply line (Berlin Defense main line) with no book flags:
// bookPlies is 0, so the opening/middlegame split lands at ply 16/17, giving
// a phase test something other than "everything is opening".
const BERLIN = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1', 'f6e4',
  'd2d4', 'e4d6', 'b5c6', 'd7c6', 'd4e5', 'd6f5', 'd1d8', 'e8d8',
  'b1c3', 'c8e6',
]

// Binary search over winPctFromCp (monotonic in cp), same convention used in
// classify.test.ts and golden.test.ts, so fixtures below hit exact round
// win% swings instead of arbitrary cp values.
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
const wp = (target: number) => winPctFromCp(cpForWhiteWinPct(target))

test('move accuracy curve endpoints and monotonicity', () => {
  // 158*exp(0) - 58 = 100 exactly (unlike the old WintrChess constants,
  // which landed at 99.99). The new curve is much steeper: it clamps to 0
  // once loss exceeds ln(58/158)/-0.11 =~ 9.11 win-pts, so most of the
  // 0..100 domain below is a flat 0.
  expect(moveAccuracyPct(0)).toBe(100)
  expect(moveAccuracyPct(100)).toBe(0)
  // non-increasing throughout (strictly decreasing until the clamp, flat
  // at 0 after); loss += 5 steps land past the ~9.11 clamp point almost
  // immediately, so "strictly less" no longer holds past loss=5.
  let prev = 101
  for (let loss = 0; loss <= 100; loss += 5) {
    const a = moveAccuracyPct(loss)
    expect(a).toBeLessThanOrEqual(prev)
    if (prev > 0) prev = a
  }
})

function ply(p: Partial<PlyAnalysis> & { ply: number }): PlyAnalysis {
  return {
    played: 'e2e4',
    best: 'e2e4',
    pv: [],
    evalAfter: { type: 'cp', value: 0 },
    classification: 'none',
    book: false,
    ...p,
  }
}

test('game accuracy splits by mover, and book plies count as full credit', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    plies: [
      ply({ ply: 1, evalAfter: { type: 'cp', value: 0 } }), // white, no loss
      ply({ ply: 2, evalAfter: { type: 'cp', value: 400 } }), // black hangs material
    ],
  }
  const { white, black } = gameAccuracies(record, null)
  expect(white).toBe(100)
  // black's loss (50 -> 18.6513, a ~31.35 win-pt hang) is well past the new
  // curve's ~9.11 clamp point, so it scores a flat 0, not a partial credit.
  expect(black).toBe(0)

  // A book ply scores 100 regardless of its (reduced-node-budget) eval swing
  // — book plies are graded as full theory credit, not fed through the curve.
  const bookRecord = {
    startEval: { type: 'cp', value: 0 } as const,
    plies: [ply({ ply: 1, book: true, evalAfter: { type: 'cp', value: -900 } })],
  }
  expect(gameAccuracies(bookRecord, null).white).toBe(100)
})

test('an all-book game scores exactly 100 for both players', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    plies: [
      ply({ ply: 1, book: true, evalAfter: { type: 'cp', value: -900 } }), // white
      ply({ ply: 2, book: true, evalAfter: { type: 'cp', value: 900 } }), // black
      ply({ ply: 3, book: true, evalAfter: { type: 'cp', value: -900 } }), // white
    ],
  }
  const { white, black } = gameAccuracies(record, null)
  expect(white).toBe(100)
  expect(black).toBe(100)
})

// --- hand-computed 3-ply fixture ---
//
// White-perspective win% walk (each rounded through cp so it matches exactly
// what gameAccuracies computes internally): 50 -> 40.0105 -> 59.9895 -> 54.9545.
//   ply1 (white): wpBefore 50, wpAfter 40.0105  -> loss  9.9895
//   ply2 (black): wpBefore 59.9895 (100-40.0105), wpAfter 40.0105 (100-59.9895) -> loss 19.9791
//   ply3 (white): wpBefore 59.9895, wpAfter 54.9545 -> loss 5.0350
// moveAccuracyPct(x) = clamp(158*exp(-0.11x) - 58, 0, 100), clamp point ~9.11:
//   f(9.9895)  = clamp(158*exp(-1.09885) - 58) = clamp(-5.3456) = 0
//   f(19.9791) = clamp(158*exp(-2.19770) - 58) = clamp(-40.4528) = 0
//   f(5.0350)  = clamp(158*exp(-0.55385) - 58) = 32.8078
// white = mean(f(9.9895), f(5.0350)) = mean(0, 32.8078) = 16.4039
// black = f(19.9791) = 0 (only one black move, well past the clamp point)
test('game accuracy on a hand-computed 3-ply fixture', () => {
  const w1 = wp(40)
  const w2 = wp(60)
  const w3 = wp(55)
  const record = {
    startEval: { type: 'cp', value: 0 } as const, // white 50%
    plies: [
      ply({ ply: 1, evalAfter: { type: 'cp', value: cpForWhiteWinPct(40) } }),
      ply({ ply: 2, evalAfter: { type: 'cp', value: cpForWhiteWinPct(60) } }),
      ply({ ply: 3, evalAfter: { type: 'cp', value: cpForWhiteWinPct(55) } }),
    ],
  }
  // Sanity check the walk lands on the win% values the comment's hand math used.
  expect(w1).toBeCloseTo(40.0105, 3)
  expect(w2).toBeCloseTo(59.9895, 3)
  expect(w3).toBeCloseTo(54.9545, 3)

  const { white, black } = gameAccuracies(record, null)
  expect(white).toBeCloseTo(16.4039, 3)
  expect(black).toBe(0)
})

// --- spiky vs flat ---
//
// NOTE ON DIRECTION: moveAccuracyPct is a convex decreasing function of loss,
// so by Jensen's inequality averaging it over a spread-out (spiky) set of
// inputs never scores below averaging it over a concentrated (flat) set with
// the same mean. With this curve's ~9.11 clamp point the effect is stark
// rather than subtle: flatLosses (10,10,10,10) sits just past the clamp on
// every move, scoring 0 across the board (flatAcc = 0); spikyLosses
// (0,0,0,40) scores 100 on three moves and 0 on the one big loss
// (spikyAcc = 75). Same average loss (10), very different mean accuracy.
test('spiky and flat games with the same average loss: spiky scores at least as high, never lower', () => {
  const flatLosses = [10, 10, 10, 10]
  const spikyLosses = [0, 0, 0, 40] // same average (10), all the loss in one move
  const meanAcc = (losses: number[]) => losses.reduce((s, l) => s + moveAccuracyPct(l), 0) / losses.length
  const flatAcc = meanAcc(flatLosses)
  const spikyAcc = meanAcc(spikyLosses)
  expect(flatAcc).toBe(0)
  expect(spikyAcc).toBe(75)
  expect(spikyAcc).toBeGreaterThan(flatAcc)
})

test('a game-ending mate costs the mover nothing', () => {
  const record = {
    startEval: { type: 'cp', value: 500 } as const,
    plies: [ply({ ply: 1, evalAfter: null })],
  }
  expect(gameAccuracies(record, 'checkmate').white).toBe(100)
})

// --- phaseAccuracies ---

test('losses bucket by phase, not just by mover', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    uciMoves: BERLIN,
    plies: BERLIN.map((played, i) =>
      ply({
        ply: i + 1,
        played,
        // ply 2 (opening, black) hangs material; ply 18 (middlegame, black) is quiet.
        evalAfter: i === 1 ? { type: 'cp', value: 400 } : { type: 'cp', value: 0 },
      }),
    ),
  }
  const phases = phaseAccuracies(record, null)
  expect(phases.opening.black).not.toBeNull()
  // ply2's ~31.35-pt hang is well past the curve's ~9.11 clamp point, so it
  // scores a flat 0 among 7 other black opening plies at loss 0 (acc 100):
  // (0 + 7*100) / 8 = 87.5. Diluted, but still measurably below the
  // untouched middlegame phase (which has no bad move to dilute).
  expect(phases.opening.black!).toBeCloseTo(87.5, 1)
  expect(phases.middlegame.black).toBe(100)
  // never reached 12 men on the board in this short line
  expect(phases.endgame.white).toBeNull()
  expect(phases.endgame.black).toBeNull()
})

test('book plies score full credit in phase accuracy, same as game accuracy', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    uciMoves: BERLIN,
    plies: BERLIN.map((played, i) =>
      ply({
        ply: i + 1,
        played,
        book: i < 4, // leading 4 plies are book
        evalAfter: i === 1 ? { type: 'cp', value: 400 } : { type: 'cp', value: 0 }, // the hang is on a book ply
      }),
    ),
  }
  // bookPlies = 4 pushes openingUntil to max(4, 16) = 16, same split as
  // before, but the ply-2 hang is now book and scores 100, not a loss. The
  // opening bucket's 6 remaining non-book black plies are all at loss 0,
  // which this curve scores as exactly 100 (158*exp(0)-58 = 100, no clamping
  // needed) — so the whole bucket lands on exactly 100, book credit and
  // curve credit alike.
  const phases = phaseAccuracies(record, null)
  expect(phases.opening.black).toBe(100)
})

test('a phase with no plies for either player is null', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    uciMoves: BERLIN.slice(0, 2),
    plies: [
      ply({ ply: 1, played: BERLIN[0] }),
      ply({ ply: 2, played: BERLIN[1] }),
    ],
  }
  const phases = phaseAccuracies(record, null)
  expect(phases.middlegame.white).toBeNull()
  expect(phases.middlegame.black).toBeNull()
  expect(phases.endgame.white).toBeNull()
  expect(phases.endgame.black).toBeNull()
})
