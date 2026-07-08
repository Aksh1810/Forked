import { expect, test } from 'vitest'
import { gameAggContribution, mergeRing, openingFamily } from '../src/aggregates.js'
import type { RingEntry } from '../src/jobs.js'
import { gamePhases } from '../src/phases.js'
import type { PlyAnalysis } from '../src/schemas.js'

test('opening family strips the variation suffix', () => {
  expect(openingFamily('B90', 'Sicilian Defense: Najdorf Variation')).toBe('Sicilian Defense')
  expect(openingFamily('C60', 'Ruy Lopez')).toBe('Ruy Lopez')
  expect(openingFamily('B20', null)).toBe('ECO B')
  expect(openingFamily(null, null)).toBe('Unknown')
})

test('ring merge keeps the last 20 in order', () => {
  const entry = (i: number): RingEntry => ({
    gameId: `g${i}`,
    accuracy: i,
    finishedAt: `t${i}`,
    opp: 'rival',
    res: 'w',
    plies: 10,
  })
  let ring: RingEntry[] = []
  for (let i = 0; i < 25; i++) ring = mergeRing(ring, entry(i))
  expect(ring).toHaveLength(20)
  expect(ring[0].gameId).toBe('g5')
  expect(ring[19].gameId).toBe('g24')
})

function ply(n: number, overrides: Partial<PlyAnalysis> = {}): PlyAnalysis {
  return {
    ply: n,
    played: 'e2e4',
    best: 'e2e4',
    pv: [],
    evalAfter: { type: 'cp', value: 0 },
    classification: 'none',
    book: false,
    ...overrides,
  }
}

test('contribution counts only the users own classified moves', () => {
  const record = {
    startEval: { type: 'cp', value: 0 } as const,
    plies: [
      ply(1, { book: true }),
      ply(2, { book: true }),
      ply(3),
      ply(4, { classification: 'blunder', evalAfter: { type: 'cp', value: 400 } }),
      ply(5),
      ply(6),
    ],
  }
  const phases: ('opening' | 'middlegame' | 'endgame')[] = [
    'opening',
    'opening',
    'opening',
    'middlegame',
    'middlegame',
    'middlegame',
  ]
  const black = gameAggContribution(record, phases, null, 'black', 'Ruy Lopez')
  expect(black.moves).toBe(2) // plies 4 and 6; ply 2 is book
  expect(black.blunders).toBe(1)
  expect(black.phaseBlunders).toEqual({ middlegame: 1 })
  expect(black.phaseMoves).toEqual({ middlegame: 2 })
  expect(black.accuracy).not.toBeNull()

  const nobody = gameAggContribution(record, phases, null, null, 'Ruy Lopez')
  expect(nobody.moves).toBe(0)
  expect(nobody.accuracy).toBeNull()
})

test('game phases: opening covers max(book, 16) plies, then middlegame', () => {
  const moves = [
    'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6',
    'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6', 'c2c3', 'e8g8',
    'h2h3', 'c6a5', 'b3c2', 'c7c5',
  ]
  const phases = gamePhases(moves, 0)
  expect(phases.slice(0, 16).every((p) => p === 'opening')).toBe(true)
  expect(phases.slice(16).every((p) => p === 'middlegame')).toBe(true)
  expect(() => gamePhases(['e2e4', 'e2e4'], 0)).toThrow(/ply 2/)
})
