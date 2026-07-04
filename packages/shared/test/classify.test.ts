import { expect, test } from 'vitest'
import { classifyWinPctSwing } from '../src/classify.js'

// [wpBefore, wpAfter, expected, note]
const CASES: [number, number, string, string][] = [
  [50, 15, 'blunder', 'loss of 35'],
  [50, 20, 'blunder', 'loss of exactly 30'],
  [50, 25, 'mistake', 'loss of 25'],
  [50, 30, 'mistake', 'loss of exactly 20'],
  [50, 38, 'inaccuracy', 'loss of 12'],
  [50, 40, 'inaccuracy', 'loss of exactly 10'],
  [50, 45, 'none', 'loss of 5'],
  [50, 70, 'none', 'gaining is never classified'],
  [95, 80, 'none', 'decided position, loss suppressed'],
  [91, 61, 'none', 'decided position, 30-point loss suppressed above the 40 line'],
  [95, 35, 'blunder', 'throw-away: 60+ down to 40- overrides suppression'],
  [100, 30, 'blunder', 'mate for the mover thrown away to losing'],
  [65, 40, 'mistake', 'throw-away at the boundary is still classified by size'],
  [60, 40, 'mistake', 'exactly 60 to exactly 40'],
  [9, 0, 'none', 'already lost, nothing left to lose'],
  [100, 95, 'none', 'mate to still winning, suppressed'],
  [0, 0, 'none', 'dead lost throughout'],
]

test.each(CASES)('before %f after %f is %s (%s)', (before, after, expected) => {
  expect(classifyWinPctSwing(before, after)).toBe(expected)
})
