import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { finalStatus, parseGamePgn } from '../src/pgn.js'
import { cacheKey } from '../src/cache-key.js'

const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/pgn/${name}`, import.meta.url), 'utf8')

test('scholars mate parses: moves, headers, terminal checkmate', () => {
  const g = parseGamePgn(fixture('scholars-mate.pgn'))
  if (!g.ok) throw new Error(g.message)
  expect(g.uciMoves).toEqual(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'])
  expect(g.result).toBe('1-0')
  expect(g.terminal).toBe('checkmate')
  expect(g.white).toEqual({ name: 'attacker', rating: 900 })
  expect(g.black).toEqual({ name: 'victim', rating: 850 })
  expect(g.date).toBe('2026-01-01')
  expect(g.clocks).toEqual([null, null, null, null, null, null, null])
})

test('%clk comments are extracted per ply into game data', () => {
  const g = parseGamePgn(fixture('same-moves-a.pgn'))
  if (!g.ok) throw new Error(g.message)
  expect(g.clocks).toEqual([178, 177.3, 175, 170.1, 160, 150, 158.6])
})

test('two games sharing a move list share a cache key but not clocks', () => {
  const a = parseGamePgn(fixture('same-moves-a.pgn'))
  const b = parseGamePgn(fixture('same-moves-b.pgn'))
  if (!a.ok || !b.ok) throw new Error('fixtures must parse')
  expect(a.uciMoves).toEqual(b.uciMoves)
  expect(cacheKey(a.uciMoves, 'Stockfish 18', 600_000)).toBe(cacheKey(b.uciMoves, 'Stockfish 18', 600_000))
  expect(a.clocks).not.toEqual(b.clocks)
  expect(a.white.name).not.toBe(b.white.name)
})

test('chess960 is rejected with a variant error', () => {
  const g = parseGamePgn(fixture('chess960.pgn'))
  expect(g.ok).toBe(false)
  if (!g.ok) expect(g.code).toBe('variant')
})

test('games under 6 plies are rejected', () => {
  const g = parseGamePgn(fixture('four-ply.pgn'))
  expect(g.ok).toBe(false)
  if (!g.ok) expect(g.code).toBe('too-short')
})

test('an illegal move is rejected with its ply number', () => {
  const g = parseGamePgn(fixture('illegal-move.pgn'))
  expect(g.ok).toBe(false)
  if (!g.ok) {
    expect(g.code).toBe('illegal-move')
    expect(g.message).toContain('ply 5')
  }
})

test('garbage input is rejected, not thrown', () => {
  const g = parseGamePgn(fixture('garbage.pgn'))
  expect(g.ok).toBe(false)
})

test('the eval-perspective fixture parses with a Ruy Lopez book prefix', () => {
  const g = parseGamePgn(fixture('eval-perspective.pgn'))
  if (!g.ok) throw new Error(g.message)
  expect(g.uciMoves).toHaveLength(16)
  expect(g.eco?.startsWith('C6')).toBe(true)
  expect(g.terminal).toBeNull()
})

test('finalStatus replays uci moves and flags checkmate', () => {
  expect(finalStatus(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'])).toBe('checkmate')
  expect(finalStatus(['e2e4', 'e7e5'])).toBeNull()
  expect(() => finalStatus(['e2e4', 'e2e5'])).toThrow(/ply 2/)
})
