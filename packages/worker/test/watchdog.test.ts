import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { analyzeGame } from '../src/analyze.js'
import { Engine, EngineTimeoutError } from '../src/uci.js'

const fake = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/fake-engines/${name}`, import.meta.url))

// 6 legal plies, not terminal: 1. e4 e5 2. Nf3 Nc6 3. Bb5 Qg5
const MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'd8g5']

let engine: Engine | null = null
let dir: string | null = null
afterEach(() => {
  engine?.dispose()
  engine = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
  delete process.env.WEDGE_MARKER
  delete process.env.CMD_LOG
})

test('a wedged engine is killed, respawned, and the game retried from scratch', async () => {
  dir = mkdtempSync(join(tmpdir(), 'forked-wedge-'))
  process.env.WEDGE_MARKER = join(dir, 'marker')
  process.env.CMD_LOG = join(dir, 'cmd.log')

  engine = await Engine.start({ enginePath: fake('wedge-once.mjs') })
  const record = await analyzeGame(engine, MOVES, { nodeBudget: 1000, watchdogMs: 300 })

  expect(engine.spawnCount).toBe(2)
  expect(record.plies).toHaveLength(6)
  const log = readFileSync(process.env.CMD_LOG, 'utf8').split('\n')
  // Retry restarted the WHOLE game: the ply-1 position was sent twice
  // (once by the wedged process, once after respawn), never resumed mid-game.
  expect(log.filter((l) => l === 'position startpos').length).toBe(2)
  expect(log.filter((l) => l === 'ucinewgame').length).toBe(2)
}, 20_000)

test('a second watchdog trip routes the game to the failure path', async () => {
  engine = await Engine.start({ enginePath: fake('wedge-always.mjs') })
  await expect(analyzeGame(engine, MOVES, { nodeBudget: 1000, watchdogMs: 200 })).rejects.toThrow(
    EngineTimeoutError,
  )
  // initial spawn + retry respawn + final respawn that leaves the engine healthy
  expect(engine.spawnCount).toBe(3)
}, 20_000)
