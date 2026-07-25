import { expect, test } from 'vitest'
import { parseUciInfo, sideToMove } from '../src/uci.js'

test('parses a normal cp line for the side to move', () => {
  const result = parseUciInfo('info depth 12 seldepth 18 multipv 1 score cp 34 nodes 100000 pv e2e4 e7e5', 'white')
  expect(result).toEqual({
    depth: 12,
    multipv: 1,
    eval: { type: 'cp', value: 34 },
    pv: ['e2e4', 'e7e5'],
    bound: false,
  })
})

test('parses a mate line', () => {
  const result = parseUciInfo('info depth 20 score mate 3 pv f7f8q', 'white')
  expect(result?.eval).toEqual({ type: 'mate', value: 3 })
})

test('negates the score for Black so it stays White-perspective', () => {
  const result = parseUciInfo('info depth 10 score cp 50 pv d2d4', 'black')
  expect(result?.eval.value).toBe(-50)
})

test('does not negate a zero score into -0 for Black', () => {
  const result = parseUciInfo('info depth 10 score cp 0 pv d2d4', 'black')
  expect(Object.is(result?.eval.value, 0)).toBe(true)
})

test('marks lowerbound and upperbound lines as bound, not exact', () => {
  const lower = parseUciInfo('info depth 10 score cp 50 lowerbound pv d2d4', 'white')
  const upper = parseUciInfo('info depth 10 score cp 50 upperbound pv d2d4', 'white')
  expect(lower?.bound).toBe(true)
  expect(upper?.bound).toBe(true)
})

test('defaults multipv to 1 when absent and parses it when present', () => {
  const absent = parseUciInfo('info depth 10 score cp 50 pv d2d4', 'white')
  const present = parseUciInfo('info depth 10 multipv 2 score cp 50 pv d2d4', 'white')
  expect(absent?.multipv).toBe(1)
  expect(present?.multipv).toBe(2)
})

test('depth is null when the line omits it', () => {
  const result = parseUciInfo('info score cp 50 pv d2d4', 'white')
  expect(result?.depth).toBeNull()
})

test('pv is empty when the line reports a score but no principal variation', () => {
  const result = parseUciInfo('info depth 10 score cp 50', 'white')
  expect(result?.pv).toEqual([])
})

test('returns null for a bestmove line', () => {
  expect(parseUciInfo('bestmove e2e4', 'white')).toBeNull()
})

test('returns null for a non-info line', () => {
  expect(parseUciInfo('readyok', 'white')).toBeNull()
})

test('returns null for an info line with no score', () => {
  expect(parseUciInfo('info depth 5 currmove e2e4 currmovenumber 1', 'white')).toBeNull()
})

test('side to move alternates starting with white at the start position', () => {
  expect(sideToMove(0)).toBe('white')
  expect(sideToMove(1)).toBe('black')
})
