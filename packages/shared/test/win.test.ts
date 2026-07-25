import { expect, test } from 'vitest'
import { cliffIndex, moverWinPct, whiteWinPct, winPctFromCp } from '../src/win.js'

test('win probability sigmoid matches the lichess formula at known points', () => {
  expect(winPctFromCp(0)).toBeCloseTo(50, 10)
  // symmetric around 0
  for (const cp of [50, 100, 250, 700, 1500]) {
    expect(winPctFromCp(cp) + winPctFromCp(-cp)).toBeCloseTo(100, 10)
  }
  // monotonic
  let prev = -1
  for (let cp = -2000; cp <= 2000; cp += 100) {
    const w = winPctFromCp(cp)
    expect(w).toBeGreaterThan(prev)
    prev = w
  }
})

test('mate maps to 100 or 0, never into centipawn arithmetic', () => {
  expect(whiteWinPct({ type: 'mate', value: 3 })).toBe(100)
  expect(whiteWinPct({ type: 'mate', value: -1 })).toBe(0)
  expect(whiteWinPct({ type: 'cp', value: 120 })).toBeLessThan(100)
})

test('mover perspective inverts for black', () => {
  const ev = { type: 'cp', value: 200 } as const
  expect(moverWinPct(ev, 'white') + moverWinPct(ev, 'black')).toBeCloseTo(100, 10)
  expect(moverWinPct({ type: 'mate', value: -2 }, 'black')).toBe(100)
})

test('cliff index marks the steepest step, in either direction', () => {
  expect(cliffIndex([60, 58, 12, 10])).toBe(2)
  // a rise is a step too: the card marks whichever move moved the graph most
  expect(cliffIndex([20, 22, 90])).toBe(2)
  // ties keep the first, so the mark never jumps between equal drops
  expect(cliffIndex([50, 30, 10])).toBe(1)
})

test('cliff index degrades safely on short or flat series', () => {
  expect(cliffIndex([])).toBe(0)
  expect(cliffIndex([50])).toBe(0)
  expect(cliffIndex([50, 50, 50])).toBe(1)
})
