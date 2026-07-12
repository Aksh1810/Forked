import { expect, test } from 'vitest'
import { clickMove, destsFor } from '../src/lib/moves.js'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

test('first click on own piece selects', () => {
  expect(clickMove(START, null, 'e2')).toEqual({ kind: 'select', from: 'e2' })
})

test('clicking the selected square deselects', () => {
  expect(clickMove(START, 'e2', 'e2')).toEqual({ kind: 'deselect' })
})

test('legal destination plays the move', () => {
  expect(clickMove(START, 'e2', 'e4')).toEqual({ kind: 'move', uci: 'e2e4' })
})

test('illegal destination resets', () => {
  expect(clickMove(START, 'e2', 'e5')).toEqual({ kind: 'reset' })
})

test('clicking another own piece re-selects', () => {
  expect(clickMove(START, 'e2', 'g1')).toEqual({ kind: 'select', from: 'g1' })
})

test('opponent piece with nothing selected resets', () => {
  expect(clickMove(START, null, 'e7')).toEqual({ kind: 'reset' })
})

test('promotion auto-queens', () => {
  const fen = '8/4P3/8/8/8/8/8/K1k5 w - - 0 1'
  expect(clickMove(fen, 'e7', 'e8')).toEqual({ kind: 'move', uci: 'e7e8q' })
})

test('destsFor lists legal destinations', () => {
  expect(destsFor(START, 'e2')?.sort()).toEqual(['e3', 'e4'])
  expect(destsFor(START, null)).toBeUndefined()
})
