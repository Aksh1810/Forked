import { expect, test } from 'vitest'
import { accuracyFromAvgLoss, gameAccuracies, phaseAccuracies } from '../src/accuracy.js'
import type { PlyAnalysis } from '../src/schemas.js'

// A real, legal 18-ply line (Berlin Defense main line) with no book flags:
// bookPlies is 0, so the opening/middlegame split lands at ply 16/17, giving
// a phase test something other than "everything is opening".
const BERLIN = [
  'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1', 'f6e4',
  'd2d4', 'e4d6', 'b5c6', 'd7c6', 'd4e5', 'd6f5', 'd1d8', 'e8d8',
  'b1c3', 'c8e6',
]

test('accuracy curve endpoints and monotonicity', () => {
  expect(accuracyFromAvgLoss(0)).toBeCloseTo(100, 2)
  expect(accuracyFromAvgLoss(100)).toBe(0)
  // strictly decreasing until the clamp at 0, never increasing after
  let prev = 101
  for (let loss = 0; loss <= 100; loss += 5) {
    const a = accuracyFromAvgLoss(loss)
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

test('game accuracy splits by mover and excludes book plies', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    plies: [
      ply({ ply: 1, evalAfter: { type: 'cp', value: 0 } }), // white, no loss
      ply({ ply: 2, evalAfter: { type: 'cp', value: 400 } }), // black hangs material
    ],
  }
  const { white, black } = gameAccuracies(record, null)
  expect(white).toBeCloseTo(100, 1)
  expect(black).not.toBeNull()
  expect(black!).toBeLessThan(80)

  const bookRecord = {
    startEval: { type: 'cp', value: 0 } as const,
    plies: [ply({ ply: 1, book: true }), ply({ ply: 2, evalAfter: { type: 'cp', value: 400 } })],
  }
  expect(gameAccuracies(bookRecord, null).white).toBeNull()
})

test('a game-ending mate costs the mover nothing', () => {
  const record = {
    startEval: { type: 'cp', value: 500 } as const,
    plies: [ply({ ply: 1, evalAfter: null })],
  }
  expect(gameAccuracies(record, 'checkmate').white).toBeCloseTo(100, 2)
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
  // diluted by several quiet opening plies, but still clearly hurt relative
  // to the untouched middlegame phase
  expect(phases.opening.black!).toBeLessThan(90)
  expect(phases.middlegame.black).toBeCloseTo(100, 1)
  // never reached 12 men on the board in this short line
  expect(phases.endgame.white).toBeNull()
  expect(phases.endgame.black).toBeNull()
})

test('book plies are excluded from phase accuracy, same as game accuracy', () => {
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
  // before, but the ply-2 hang is now book and must not count.
  const phases = phaseAccuracies(record, null)
  expect(phases.opening.black).toBeCloseTo(100, 1)
})

test('a phase with no non-book plies for either player is null', () => {
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
