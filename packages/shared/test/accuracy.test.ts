import { expect, test } from 'vitest'
import { accuracyFromAvgLoss, gameAccuracies } from '../src/accuracy.js'
import type { PlyAnalysis } from '../src/schemas.js'

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
