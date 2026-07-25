import { expect, test } from 'vitest'
import { walkGame } from '../src/walk.js'
import { userMoves } from '../src/insights.js'
import { openingFamily } from '../src/aggregates.js'
import { gameAccuracies } from '../src/accuracy.js'
import { finalStatus } from '../src/pgn.js'
import { ITALIAN, mkGame } from './analyzed-game.js'

const cleanWin = mkGame({
  gameId: 'g-clean',
  uciMoves: ITALIAN,
  userColor: 'white',
  result: '1-0',
  eco: 'C50',
  openingName: 'Italian Game: Two Knights',
})

test('walkGame memoizes: repeated calls on the same object return the identical walk', () => {
  const a = walkGame(cleanWin)
  const b = walkGame(cleanWin)
  expect(a).toBe(b)
})

test('two structurally-equal but distinct AnalyzedGame objects get their own walk', () => {
  const twin = mkGame({
    gameId: 'g-clean',
    uciMoves: ITALIAN,
    userColor: 'white',
    result: '1-0',
    eco: 'C50',
    openingName: 'Italian Game: Two Knights',
  })
  const a = walkGame(cleanWin)
  const b = walkGame(twin)
  expect(a).not.toBe(b)
  expect(a).toEqual(b)
})

test('walk.moves matches userMoves(g)', () => {
  expect(walkGame(cleanWin).moves).toEqual(userMoves(cleanWin))
})

test('walk.terminal, family, opponent, and accuracies match the direct per-function calls', () => {
  const w = walkGame(cleanWin)
  expect(w.terminal).toBe(finalStatus(cleanWin.record.uciMoves))
  expect(w.family).toBe(openingFamily(cleanWin.game.eco, cleanWin.game.openingName))
  expect(w.opponent).toBe(cleanWin.game.black.name)
  expect(w.accuracies).toEqual(gameAccuracies(cleanWin.record, w.terminal))
})

test('a game with userColor null yields an empty moves array', () => {
  const anon = mkGame({ gameId: 'g-anon', uciMoves: ITALIAN, userColor: null })
  expect(walkGame(anon).moves).toEqual([])
})
