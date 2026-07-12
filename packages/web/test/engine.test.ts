import { expect, test } from 'vitest'
import { parseInfoLine } from '../src/lib/engine.js'

test('parses a positive cp score, white to move', () => {
  const r = parseInfoLine('info depth 12 seldepth 18 score cp 34 nodes 123 pv e2e4 e7e5', false)
  expect(r).toEqual({ depth: 12, multipv: 1, eval: { type: 'cp', value: 34 }, pvUci: ['e2e4', 'e7e5'] })
})

test('negates cp score when black to move', () => {
  const r = parseInfoLine('info depth 14 score cp 50 nodes 123 pv e7e5 g1f3', true)
  expect(r?.eval).toEqual({ type: 'cp', value: -50 })
})

test('negates mate score when black to move, staying non-zero', () => {
  const r = parseInfoLine('info depth 8 score mate 3 nodes 123 pv f7f5 e4f5 g8f6', true)
  expect(r?.eval).toEqual({ type: 'mate', value: -3 })
})

test('leaves mate score alone when white to move', () => {
  const r = parseInfoLine('info depth 8 score mate -2 nodes 123 pv f7f5 e4f5', false)
  expect(r?.eval).toEqual({ type: 'mate', value: -2 })
})

test('rejects a bound line (not an exact score)', () => {
  const r = parseInfoLine('info depth 10 score cp 20 upperbound nodes 123 pv e2e4', false)
  expect(r).toBeNull()
})

test('rejects a lowerbound line too', () => {
  const r = parseInfoLine('info depth 10 score cp 20 lowerbound nodes 123 pv e2e4', false)
  expect(r).toBeNull()
})

test('rejects bestmove lines', () => {
  expect(parseInfoLine('bestmove e2e4 ponder e7e5', false)).toBeNull()
})

test('rejects junk / non-score info lines', () => {
  expect(parseInfoLine('info string NNUE evaluation enabled', false)).toBeNull()
  expect(parseInfoLine('info depth 5 currmove e2e4 currmovenumber 1', false)).toBeNull()
  expect(parseInfoLine('', false)).toBeNull()
})

test('extracts the full pv tail', () => {
  const r = parseInfoLine('info depth 20 score cp 12 pv e2e4 e7e5 g1f3 b8c6 f1b5', false)
  expect(r?.pvUci).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])
})

test('parses the multipv index', () => {
  const r = parseInfoLine('info depth 12 multipv 2 score cp -8 nodes 99 pv d2d4 g8f6', false)
  expect(r).toEqual({ depth: 12, multipv: 2, eval: { type: 'cp', value: -8 }, pvUci: ['d2d4', 'g8f6'] })
})

test('multipv defaults to 1 when absent', () => {
  const r = parseInfoLine('info depth 10 score cp 5 pv e2e4', false)
  expect(r?.multipv).toBe(1)
})

test('negates each multipv line independently when black to move', () => {
  const r = parseInfoLine('info depth 11 multipv 3 score cp 40 pv c7c5', true)
  expect(r?.eval).toEqual({ type: 'cp', value: -40 })
})
