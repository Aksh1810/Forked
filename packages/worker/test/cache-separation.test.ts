import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import {
  GameRecordSchema,
  cacheKey,
  parseGamePgn,
  type EngineRecord,
  type GameRecord,
} from '@forked/shared'
import { analyzeGame } from '../src/analyze.js'
import { Engine } from '../src/uci.js'

const SCRIPTED = fileURLToPath(new URL('../../../fixtures/fake-engines/scripted.mjs', import.meta.url))
const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/fake-engines/pgn/${name}`, import.meta.url), 'utf8')

let engine: Engine | null = null
afterEach(() => {
  engine?.dispose()
  engine = null
  delete process.env.SCRIPT
})

// Gate: two different games sharing an identical move list produce exactly
// ONE shared engine record and TWO separate game records with distinct clocks.
test('identical move lists share one engine record, never clock data', async () => {
  process.env.SCRIPT = JSON.stringify([
    ['info depth 3 multipv 1 score cp 10 nodes 20 pv e2e4', 'bestmove e2e4'],
  ])
  engine = await Engine.start({ enginePath: SCRIPTED })

  const engineStore = new Map<string, EngineRecord>()
  const gameRecords: GameRecord[] = []
  let analyses = 0

  for (const [id, file] of [
    ['game-a', 'same-moves-a.pgn'],
    ['game-b', 'same-moves-b.pgn'],
  ] as const) {
    const parsed = parseGamePgn(fixture(file))
    if (!parsed.ok) throw new Error(parsed.message)
    const key = cacheKey(parsed.uciMoves, engine.version, 1000)
    if (!engineStore.has(key)) {
      engineStore.set(key, await analyzeGame(engine, parsed.uciMoves, { nodeBudget: 1000 }))
      analyses += 1
    }
    gameRecords.push(
      GameRecordSchema.parse({
        gameId: id,
        white: parsed.white,
        black: parsed.black,
        timeControl: parsed.timeControl,
        result: parsed.result,
        date: parsed.date,
        clocks: parsed.clocks,
        eco: parsed.eco,
        openingName: parsed.openingName,
        cacheKey: key,
      }),
    )
  }

  expect(engineStore.size).toBe(1)
  expect(analyses).toBe(1)
  expect(gameRecords).toHaveLength(2)
  expect(gameRecords[0].cacheKey).toBe(gameRecords[1].cacheKey)
  expect(gameRecords[0].clocks).not.toEqual(gameRecords[1].clocks)
  // A cache hit is provably incapable of importing another game's clocks:
  // the engine record's schema has no clock field at all.
  const shared = engineStore.get(gameRecords[0].cacheKey)!
  expect(Object.keys(shared)).not.toContain('clocks')
  expect(Object.keys(shared.plies[0])).not.toContain('clk')
}, 20_000)
