import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { finalStatus, parseGamePgn, sanMoves } from '../src/pgn.js'
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

test('a player name of the literal string "undefined" normalizes to a placeholder', () => {
  const pgn =
    '[White "undefined"]\n[Black "erik"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n'
  const g = parseGamePgn(pgn)
  if (!g.ok) throw new Error(g.message)
  expect(g.white.name).toBe('?')
  expect(g.black.name).toBe('erik')
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

test('sanMoves converts standard-UCI castling to O-O', () => {
  const uci = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1']
  expect(sanMoves(uci)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
})

test('sanMoves converts a capturing promotion, and check/mate suffixes', () => {
  const uci = ['h2h4', 'g7g5', 'h4g5', 'h7h5', 'g5g6', 'h5h4', 'g6g7', 'h4h3', 'g7h8q']
  expect(sanMoves(uci).at(-1)).toBe('gxh8=Q')

  const mate = sanMoves(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'])
  expect(mate.at(-1)).toBe('Qxf7#')
})

test('sanMoves replays a prefix for PV lines without including it in the output', () => {
  const prefix = ['e2e4', 'e7e5']
  expect(sanMoves(['g1f3', 'b8c6'], prefix)).toEqual(['Nf3', 'Nc6'])
})

test('a game past 600 plies is rejected as too-long, never analyzed', () => {
  // 200 knight shuffles = 800 plies of legal chess (move numbers are optional).
  const shuffle = 'Nf3 Nf6 Ng1 Ng8 '.repeat(200)
  const g = parseGamePgn(`[White "a"]\n[Black "b"]\n\n${shuffle} *`)
  expect(g.ok).toBe(false)
  if (!g.ok) expect(g.code).toBe('too-long')
})

test('oversized header fields are truncated at parse, not stored', () => {
  const g = parseGamePgn(
    `[White "${'x'.repeat(5000)}"]\n[Black "b"]\n[TimeControl "${'9'.repeat(500)}"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *`,
  )
  if (!g.ok) throw new Error(g.message)
  expect(g.white.name.length).toBeLessThanOrEqual(60)
  expect(g.timeControl.length).toBeLessThanOrEqual(32)
})
