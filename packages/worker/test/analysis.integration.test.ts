import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { matchOpening, parseGamePgn, whiteWinPct } from '@forked/shared'
import { analyzeGame } from '../src/analyze.js'
import { Engine } from '../src/uci.js'

// Real-engine integration tests at a tiny node budget. Skipped locally when
// no stockfish binary is installed; always run in CI.
const bin = process.env.STOCKFISH_PATH ?? 'stockfish'
const probe = spawnSync(bin, [], { input: 'quit\n', encoding: 'utf8', timeout: 5_000 })
const available = !probe.error
const itEngine = it.skipIf(!available && !process.env.CI)

const NODES = 20_000
const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/fake-engines/pgn/${name}`, import.meta.url), 'utf8')

function parsed(name: string) {
  const g = parseGamePgn(fixture(name))
  if (!g.ok) throw new Error(g.message)
  return g
}

let engine: Engine
beforeAll(async () => {
  if (available || process.env.CI) engine = await Engine.start()
})
afterAll(() => engine?.dispose())

itEngine('gate a: scholars mate classifications are sane', async () => {
  const g = parsed('scholars-mate.pgn')
  const record = await analyzeGame(engine, g.uciMoves, { nodeBudget: NODES })

  expect(record.engineVersion).toContain('Stockfish')
  expect(record.plies).toHaveLength(7)
  // 3... Nf6?? allows mate in one: a blunder, and not a book move.
  const nf6 = record.plies[5]
  expect(nf6.book).toBe(false)
  expect(nf6.classification).toBe('blunder')
  expect(nf6.evalAfter).toEqual({ type: 'mate', value: 1 })
  // 4. Qxf7# ends the game: terminal ply stores no engine eval and is never
  // classified against the mover.
  const mate = record.plies[6]
  expect(mate.evalAfter).toBeNull()
  expect(mate.classification).toBe('none')
  // Early book plies are excluded from classification entirely.
  const book = matchOpening(g.uciMoves)?.plies ?? 0
  expect(book).toBeLessThanOrEqual(4)
  for (const p of record.plies.slice(0, book)) {
    expect(p.book).toBe(true)
    expect(p.classification).toBe('none')
  }
}, 120_000)

itEngine('gate b: the same game analyzed twice is byte-identical', async () => {
  const g = parsed('scholars-mate.pgn')
  const first = await analyzeGame(engine, g.uciMoves, { nodeBudget: NODES })
  const second = await analyzeGame(engine, g.uciMoves, { nodeBudget: NODES })
  expect(JSON.stringify(second)).toBe(JSON.stringify(first))
}, 120_000)

itEngine('gate c: the stored eval series never zigzags sign after a decisive swing', async () => {
  const g = parsed('eval-perspective.pgn')
  const record = await analyzeGame(engine, g.uciMoves, { nodeBudget: NODES })

  expect(record.plies).toHaveLength(16)
  // Plies 1..5 are Ruy Lopez book; 3... Qg5?? hangs the queen.
  for (const p of record.plies.slice(0, 5)) expect(p.book).toBe(true)
  expect(record.plies[5].book).toBe(false)
  expect(record.plies[5].classification).toBe('blunder')
  // From 4. Nxg5 onward White is up a whole queen: every stored evaluation
  // must stay strongly White-positive. A ply-to-ply alternating sign here is
  // the classic symptom of broken side-to-move normalization.
  for (const p of record.plies.slice(6)) {
    const ev = p.evalAfter!
    const winning = ev.type === 'mate' ? ev.value > 0 : ev.value > 300
    expect(winning, `ply ${p.ply} eval ${JSON.stringify(ev)} must stay White-winning`).toBe(true)
    expect(whiteWinPct(ev)).toBeGreaterThan(80)
  }
}, 120_000)
