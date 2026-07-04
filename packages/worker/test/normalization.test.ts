import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { Engine } from '../src/uci.js'

const SCRIPTED = fileURLToPath(new URL('../../../fixtures/fake-engines/scripted.mjs', import.meta.url))

let engine: Engine | null = null
afterEach(() => {
  engine?.dispose()
  engine = null
  delete process.env.SCRIPT
})

async function start(script: string[][]): Promise<Engine> {
  process.env.SCRIPT = JSON.stringify(script)
  engine = await Engine.start({ enginePath: SCRIPTED })
  return engine
}

test('black-to-move cp score is negated to White perspective', async () => {
  const e = await start([
    ['info depth 10 multipv 1 score cp -50 nodes 99 pv e7e5 g1f3', 'bestmove e7e5'],
  ])
  const r = await e.analyzePosition(['e2e4'], 1000)
  expect(r.eval).toEqual({ type: 'cp', value: 50 })
  expect(r.best).toBe('e7e5')
  expect(r.pv).toEqual(['e7e5', 'g1f3'])
})

test('white-to-move cp score passes through unchanged', async () => {
  const e = await start([['info depth 8 multipv 1 score cp 30 pv d2d4', 'bestmove d2d4']])
  const r = await e.analyzePosition([], 1000)
  expect(r.eval).toEqual({ type: 'cp', value: 30 })
})

test('black-to-move mate score flips sign: black mating is negative for White', async () => {
  const e = await start([['info depth 12 multipv 1 score mate 3 pv d8h4', 'bestmove d8h4']])
  const r = await e.analyzePosition(['e2e4'], 1000)
  expect(r.eval).toEqual({ type: 'mate', value: -3 })
})

test('multipv 2 lines are ignored', async () => {
  const e = await start([
    [
      'info depth 5 multipv 1 score cp 20 pv d2d4',
      'info depth 5 multipv 2 score cp -10 pv e2e4',
      'bestmove d2d4',
    ],
  ])
  const r = await e.analyzePosition([], 1000)
  expect(r.eval).toEqual({ type: 'cp', value: 20 })
})

test('pv is trimmed to 6 plies and ponder is stripped from bestmove', async () => {
  const e = await start([
    [
      'info depth 9 multipv 1 score cp 5 pv a2a3 a7a6 b2b3 b7b6 c2c3 c7c6 d2d3 d7d6',
      'bestmove a2a3 ponder a7a6',
    ],
  ])
  const r = await e.analyzePosition([], 1000)
  expect(r.pv).toHaveLength(6)
  expect(r.best).toBe('a2a3')
})

test('engine version is captured from id name', async () => {
  const e = await start([['info depth 1 multipv 1 score cp 0 pv e2e4', 'bestmove e2e4']])
  expect(e.version).toBe('FakeScripted 1')
})
