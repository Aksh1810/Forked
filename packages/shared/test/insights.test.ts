import { expect, test } from 'vitest'
import { computeInsights } from '../src/insights.js'
import { selectDelighter } from '../src/delighter.js'
import { buildWrappedSummary, WrappedSummarySchema } from '../src/wrapped.js'
import { ITALIAN, SCHOLARS, mkGame } from './analyzed-game.js'

// Black hangs mate on ply 6 with under 10 seconds on the clock, on 2026-06-02.
const blackBlunder = mkGame({
  gameId: 'g-blunder',
  uciMoves: SCHOLARS,
  userColor: 'black',
  result: '1-0',
  date: '2026-06-02',
  clocks: [300, 300, 250, 250, 200, 8, null],
  eco: 'C50',
  openingName: 'Italian Game: Two Knights',
  plies: { 6: { classification: 'blunder', evalAfter: { type: 'mate', value: 1 } } },
})

// A clean win the user played accurately: their best moment.
const cleanWin = mkGame({
  gameId: 'g-clean',
  uciMoves: ITALIAN,
  userColor: 'white',
  result: '1-0',
  date: '2026-06-03',
})

test('worst blunder is the biggest win-probability drop, with a board and cliff', () => {
  const ins = computeInsights([blackBlunder, cleanWin])
  expect(ins.totalGames).toBe(2)
  expect(ins.worstBlunder?.gameId).toBe('g-blunder')
  expect(ins.worstBlunder?.ply).toBe(6)
  expect(ins.worstBlunder?.move).toBe('g8f6')
  expect(ins.worstBlunder?.lossPct).toBeGreaterThanOrEqual(30)
  expect(ins.worstBlunder?.fen).toContain('/') // a real FEN board
  expect(ins.worstBlunder?.cliff.length).toBeGreaterThan(0)
})

test('worst day is the date carrying the most blunders', () => {
  const ins = computeInsights([blackBlunder, cleanWin])
  expect(ins.worstDay?.date).toBe('2026-06-02')
  expect(ins.worstDay?.blunders).toBe(1)
})

test('time-pressure accuracy is lower under ten seconds than overall', () => {
  const ins = computeInsights([blackBlunder])
  const under = ins.timeBuckets.find((b) => b.label === '<10s')
  expect(under?.moves).toBe(1)
  // the blunder is the sub-10s move, so that bucket's accuracy is the floor
  expect(under?.accuracy).not.toBeNull()
  expect(ins.timePressure.dropPct).not.toBeNull()
})

test('flex is the highest-accuracy game', () => {
  const ins = computeInsights([blackBlunder, cleanWin])
  expect(ins.flex?.gameId).toBe('g-clean')
  expect(ins.flex?.accuracy).toBeGreaterThan(90)
})

test('a user with no matched color contributes no insights', () => {
  const anon = mkGame({ gameId: 'g-anon', uciMoves: ITALIAN, userColor: null })
  const ins = computeInsights([anon])
  expect(ins.accuracy).toBeNull()
  expect(ins.worstBlunder).toBeNull()
  expect(ins.blunderRateByFamily).toEqual([])
})

test('delighter picks the recurring opponent when one is faced repeatedly', () => {
  const games = [0, 1, 2].map((i) =>
    mkGame({ gameId: `g${i}`, uciMoves: ITALIAN, userColor: 'white', black: 'nemesis', result: '1-0' }),
  )
  const d = selectDelighter(games)
  expect(d).toEqual({ kind: 'most-faced', opponent: 'nemesis', count: 3 })
})

test('the wrapped summary validates against its schema and is deterministic', () => {
  const stamp = '2026-07-05T00:00:00.000Z'
  const a = buildWrappedSummary([blackBlunder, cleanWin], { username: 'tester', generatedAt: stamp })
  const b = buildWrappedSummary([blackBlunder, cleanWin], { username: 'tester', generatedAt: stamp })
  expect(() => WrappedSummarySchema.parse(a)).not.toThrow()
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  expect(a.archetype.key).toBeTruthy()
  expect(a.totalGames).toBe(2)
})
