import { expect, test } from 'vitest'
import { matchOpening } from '../src/openings.js'
import { cacheKey } from '../src/cache-key.js'

test('single known first move matches', () => {
  const m = matchOpening(['e2e4'])
  expect(m).not.toBeNull()
  expect(m!.eco).toBe('B00')
  expect(m!.plies).toBe(1)
})

test('longest prefix wins: ruy lopez over kings pawn', () => {
  const m = matchOpening(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])
  expect(m).not.toBeNull()
  expect(m!.eco).toBe('C60')
  expect(m!.name).toContain('Ruy Lopez')
  expect(m!.plies).toBe(5)
})

test('off-book continuation keeps the book prefix length', () => {
  const m = matchOpening(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'd8g5', 'f3g5'])
  expect(m).not.toBeNull()
  expect(m!.plies).toBe(5)
})

test('nonsense start has no match', () => {
  expect(matchOpening(['a2a4', 'h7h5', 'a4a5'])?.plies ?? 0).toBeLessThanOrEqual(2)
  expect(matchOpening([])).toBeNull()
})

test('cache keys are stable hex and sensitive to every input', () => {
  const k = cacheKey(['e2e4'], 'Stockfish 18', 600_000)
  expect(k).toMatch(/^[0-9a-f]{64}$/)
  expect(cacheKey(['e2e4'], 'Stockfish 18', 600_000)).toBe(k)
  expect(cacheKey(['d2d4'], 'Stockfish 18', 600_000)).not.toBe(k)
  expect(cacheKey(['e2e4'], 'Stockfish 17', 600_000)).not.toBe(k)
  expect(cacheKey(['e2e4'], 'Stockfish 18', 500_000)).not.toBe(k)
})
