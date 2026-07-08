import { expect, test } from 'vitest'
import { archetype, type ArchetypeFeatures } from '../src/archetype.js'

// Neutral baseline that matches only the fallback; each case overrides just
// the features its rule needs, proving the ordered dispatch in isolation.
const base: ArchetypeFeatures = {
  games: 60,
  timePressureDropPct: 0,
  maxFamilyShare: 0.1,
  overallBlunderRate: 0.05,
  losingBlunderRate: 0.05,
  losingMoves: 40,
  medianPlies: 60,
  bookDepthAvg: 4,
  postBookAccuracyDropPct: 0,
  winningConversion: 0.5,
  winningReached: 20,
  accuracyStdev: 5,
}

const cases: [string, Partial<ArchetypeFeatures>, string][] = [
  ['flagged wins on 25pt time drop', { timePressureDropPct: 25 }, 'flagged'],
  ['one trick knight at 40% family share', { maxFamilyShare: 0.4 }, 'one-trick-knight'],
  ['hope chess at 2x losing blunder rate', { losingBlunderRate: 0.1, overallBlunderRate: 0.05 }, 'hope-chess'],
  ['grinder at 110 median plies', { medianPlies: 110 }, 'grinder'],
  ['theory sprinter: deep book then cliff', { bookDepthAvg: 12, postBookAccuracyDropPct: 20 }, 'theory-sprinter'],
  ['converter at 85% conversion', { winningConversion: 0.85, winningReached: 6 }, 'converter'],
  ['chaos merchant at high variance', { accuracyStdev: 18 }, 'chaos-merchant'],
  ['solid one is the fallback', {}, 'solid-one'],
]

test.each(cases)('%s', (_name, overrides, expected) => {
  expect(archetype({ ...base, ...overrides }).key).toBe(expected)
})

test('order matters: time pressure beats a one-trick repertoire', () => {
  expect(archetype({ ...base, timePressureDropPct: 30, maxFamilyShare: 0.9 }).key).toBe('flagged')
})

test('hope chess needs both the ratio and a real sample', () => {
  // 2x ratio but only 5 losing moves: too few to trust, falls through.
  expect(archetype({ ...base, losingBlunderRate: 0.2, losingMoves: 5 }).key).toBe('solid-one')
})

test('converter needs enough winning positions reached', () => {
  expect(archetype({ ...base, winningConversion: 1, winningReached: 3 }).key).toBe('solid-one')
})

test('every archetype carries a description and an annotation mark', () => {
  for (const [, overrides] of cases) {
    const a = archetype({ ...base, ...overrides })
    expect(a.description.length).toBeGreaterThan(0)
    expect(['??', '?', '?!', '!', 'book']).toContain(a.mark)
  }
})
