import { expect, test } from 'vitest'
import { clickMove, destsFor, terminalEval } from '../src/lib/moves.js'

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

test('terminalEval reads mate for the winner (white delivered) as +1', () => {
  // Black king g8, checkmated by white queen g7 backed by king g6.
  expect(terminalEval('6k1/6Q1/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ type: 'mate', value: 1 })
})

test('terminalEval reads mate for the winner (black delivered) as -1', () => {
  // Fool's-mate-shaped mate: white to move, checkmated -> black delivered it.
  expect(terminalEval('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toEqual({
    type: 'mate',
    value: -1,
  })
})

test('terminalEval reads stalemate as a dead-even cp 0', () => {
  expect(terminalEval('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ type: 'cp', value: 0 })
})

test('terminalEval is null for an ongoing position', () => {
  expect(terminalEval(START)).toBeNull()
})
