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
  // 103.16*exp(0) - 3.17 = 99.99, not 100 (WintrChess's constants don't
  // round to a perfect ceiling the way lichess's 103.1668/-3.1669 do).
  expect(moveAccuracyPct(0)).toBeCloseTo(99.99, 2)
  expect(moveAccuracyPct(100)).toBe(0)
  // strictly decreasing until the clamp at 0, never increasing after
  let prev = 101
  for (let loss = 0; loss <= 100; loss += 5) {
    const a = moveAccuracyPct(loss)
    if (prev > 0) expect(a).toBeLessThan(prev)
    else expect(a).toBe(0)
    prev = a
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
  expect(white).toBeCloseTo(99.99, 1)
  expect(black).not.toBeNull()
  expect(black!).toBeLessThan(80)

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
// moveAccuracyPct(x) = clamp(103.16*exp(-0.04x) - 3.17, 0, 100):
//   f(9.9895)  = 103.16*exp(-0.39958) - 3.17 = 66.0092
//   f(19.9791) = 103.16*exp(-0.79916) - 3.17 = 43.2216
//   f(5.0350)  = 103.16*exp(-0.20140) - 3.17 = 81.1720
// white = mean(f(9.9895), f(5.0350)) = mean(66.0092, 81.1720) = 73.5906
// black = f(19.9791) = 43.2216 (only one black move)
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
  expect(white).toBeCloseTo(73.5906, 3)
  expect(black).toBeCloseTo(43.2216, 3)
})

// --- spiky vs flat ---
//
// NOTE ON DIRECTION: moveAccuracyPct is a convex decreasing function of loss
// (each additional loss point costs LESS accuracy than the one before —
// 0->10 costs ~34 points, 90->100 costs under 1). By Jensen's inequality,
// averaging a convex function over a spread-out (spiky) set of inputs never
// scores below averaging it over a concentrated (flat) set with the same
// mean — it scores AT LEAST as high, because the curve's steep low-loss
// region punishes the flat game's "everyone loses a little" pattern harder
// than it rewards the spiky game's mix of many-zero-loss moves diluting one
// large one. This is verified directly below. (The plan this was built from
// expected the opposite; that expectation doesn't hold for a plain
// arithmetic mean of THIS specific convex curve — flagged for the plan
// owner, not silently "fixed" by asserting something false.)
test('spiky and flat games with the same average loss: spiky scores at least as high, never lower', () => {
  const flatLosses = [10, 10, 10, 10]
  const spikyLosses = [0, 0, 0, 40] // same average (10), all the loss in one move
  const meanAcc = (losses: number[]) => losses.reduce((s, l) => s + moveAccuracyPct(l), 0) / losses.length
  const flatAcc = meanAcc(flatLosses)
  const spikyAcc = meanAcc(spikyLosses)
  expect(spikyAcc).toBeGreaterThan(flatAcc)
})

test('a game-ending mate costs the mover nothing', () => {
  const record = {
    startEval: { type: 'cp', value: 500 } as const,
    plies: [ply({ ply: 1, evalAfter: null })],
  }
  expect(gameAccuracies(record, 'checkmate').white).toBeCloseTo(99.99, 2)
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
  // Diluted by several quiet (near-100) opening plies — per-move-then-mean
  // pulls a single big blunder's damage up rather than down (moveAccuracyPct
  // is convex in loss, so Jensen's inequality means a mostly-perfect phase
  // with one bad move scores HIGHER than a phase with the same total loss
  // spread evenly; see the spiky-vs-flat test above) — but it's still
  // measurably below the untouched middlegame phase.
  expect(phases.opening.black!).toBeLessThan(95)
  expect(phases.middlegame.black).toBeCloseTo(99.99, 1)
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
  // opening bucket still has 6 non-book black plies at loss 0 (accuracy
  // 99.99, not literally 100), so the mean lands just under 100 rather than
  // exactly on it — well above the pre-fix number, which the hang tanked.
  const phases = phaseAccuracies(record, null)
  expect(phases.opening.black).toBeGreaterThan(99.9)
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
