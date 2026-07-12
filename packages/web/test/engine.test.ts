import { beforeEach, expect, test } from 'vitest'
import { LiveEngine, parseInfoLine, type EngineUpdate } from '../src/lib/engine.js'

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

// --- LiveEngine serialize-on-bestmove tests ---------------------------------
//
// A minimal fake UCI worker: records what LiveEngine posts to it and lets a
// test push lines back in as if the wasm engine emitted them.
class FakeWorker {
  posted: string[] = []
  private messageListeners: ((e: MessageEvent<string>) => void)[] = []

  postMessage(msg: string) {
    this.posted.push(msg)
  }
  addEventListener(type: string, cb: (e: MessageEvent<string>) => void) {
    if (type === 'message') this.messageListeners.push(cb)
  }
  removeEventListener(type: string, cb: (e: MessageEvent<string>) => void) {
    if (type === 'message') this.messageListeners = this.messageListeners.filter((l) => l !== cb)
  }
  terminate() {}

  // test helper — deliver a line to whatever's currently listening
  emit(line: string) {
    for (const l of [...this.messageListeners]) l({ data: line } as MessageEvent<string>)
  }
}

// engine.ts only touches `document` inside start()/dispose() (visibilitychange),
// which this suite doesn't exercise beyond registering/removing the listener.
// The packages/web vitest project is node-env, so stub just enough to satisfy
// those calls without changing anything about LiveEngine itself.
beforeEach(() => {
  ;(globalThis as unknown as { document: unknown }).document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  }
})

async function setup(): Promise<{ engine: LiveEngine; worker: FakeWorker }> {
  let worker!: FakeWorker
  ;(globalThis as unknown as { Worker: unknown }).Worker = class {
    constructor() {
      worker = new FakeWorker()
      return worker as unknown as Worker
    }
  }
  const engine = new LiveEngine()
  const startPromise = engine.start()
  // drive the start() handshake (uci -> setoption -> isready -> readyok);
  // it uses its own temporary listener that removes itself on readyok.
  worker.emit('uciok')
  worker.emit('readyok')
  await startPromise
  return { engine, worker }
}

test('terminal position: mate-0 info + bestmove (none) fires exactly one terminal update', async () => {
  const { engine, worker } = await setup()
  const updates: EngineUpdate[] = []
  engine.analyze('8/8/8/8/8/6k1/6q1/6K1 w - - 0 1', (u) => updates.push(u))

  // No interrupt in flight, so the search starts immediately — no stop, no
  // isready, just position+go.
  expect(worker.posted.at(-2)).toBe('position fen 8/8/8/8/8/6k1/6q1/6K1 w - - 0 1')
  expect(worker.posted.at(-1)).toBe('go movetime 8000')

  worker.emit('info depth 0 score mate 0')
  worker.emit('bestmove (none)')

  expect(updates).toHaveLength(1)
  expect(updates[0]).toEqual({ depth: 0, lines: [], terminal: true })
})

test('rapid triple interrupt: only one stop is posted, and only the newest fen is searched', async () => {
  const { engine, worker } = await setup()
  const updatesA: EngineUpdate[] = []
  const updatesB: EngineUpdate[] = []
  const updatesC: EngineUpdate[] = []

  // Three analyze() calls in a row, none of A's or B's bestmove ever arrives
  // — the old counter-based design would climb to 2 and never drain,
  // permanently swallowing every subsequent line.
  engine.analyze('fenA w - - 0 1', (u) => updatesA.push(u))
  engine.analyze('fenB w - - 0 1', (u) => updatesB.push(u))
  engine.analyze('fenC w - - 0 1', (u) => updatesC.push(u))

  // B's analyze() is the transition into "interrupt pending" (posts stop);
  // C just overwrites the queued target without piling on another stop.
  expect(worker.posted.filter((m) => m === 'stop')).toHaveLength(1)
  expect(worker.posted.filter((m) => m.startsWith('position fen'))).toEqual(['position fen fenA w - - 0 1'])

  // A's bestmove finally arrives — it belongs to an abandoned search, so it
  // launches the queued target directly. B is never searched.
  worker.emit('bestmove a2a3 ponder a7a6')
  expect(worker.posted.filter((m) => m.startsWith('position fen'))).toEqual([
    'position fen fenA w - - 0 1',
    'position fen fenC w - - 0 1',
  ])
  expect(worker.posted.at(-1)).toBe('go movetime 8000')

  worker.emit('info depth 12 score cp 34 pv e2e4 e7e5')
  expect(updatesA).toHaveLength(0)
  expect(updatesB).toHaveLength(0)
  expect(updatesC).toHaveLength(1)
  expect(updatesC[0].lines[0].pvUci).toEqual(['e2e4', 'e7e5'])
})

test('terminal after an interrupt: abandoned search gives way to a mate search, terminal update fires', async () => {
  // This is the exact scenario that broke the readyok-fence design: this
  // wasm build never answers isready mid-search, so the fence never lifted
  // and the terminal bestmove (none) was dropped — UI stuck on "Loading
  // engine…" after fool's mate.
  const { engine, worker } = await setup()
  const updatesA: EngineUpdate[] = []
  const updatesMate: EngineUpdate[] = []

  engine.analyze('fenA w - - 0 1', (u) => updatesA.push(u))
  engine.analyze('8/8/8/8/8/6k1/6q1/6K1 w - - 0 1', (u) => updatesMate.push(u))
  expect(worker.posted.filter((m) => m === 'stop')).toHaveLength(1)

  worker.emit('bestmove d2d4 ponder d7d5') // A's abandoned search reports in
  expect(worker.posted.at(-2)).toBe('position fen 8/8/8/8/8/6k1/6q1/6K1 w - - 0 1')
  expect(worker.posted.at(-1)).toBe('go movetime 8000')

  worker.emit('info depth 0 score mate 0')
  worker.emit('bestmove (none)')

  expect(updatesA).toHaveLength(0)
  expect(updatesMate).toHaveLength(1)
  expect(updatesMate[0]).toEqual({ depth: 0, lines: [], terminal: true })
})

test('stale info lines after stop but before the old bestmove are dropped, never cached under the new fen', async () => {
  const { engine, worker } = await setup()
  engine.analyze('fenA w - - 0 1', () => {})

  const updatesB: EngineUpdate[] = []
  engine.analyze('fenB w - - 0 1', (u) => updatesB.push(u))

  // A's search draining out before its bestmove — must be ignored, not
  // delivered to B's callback and not cached under fenB.
  worker.emit('info depth 12 score cp 99 pv a2a3')
  expect(updatesB).toHaveLength(0)

  worker.emit('bestmove a2a3 ponder a7a6') // A's bestmove launches B's real search
  worker.emit('info depth 12 score cp 5 pv b2b3')
  expect(updatesB).toHaveLength(1)
  expect(updatesB[0].lines[0].eval).toEqual({ type: 'cp', value: 5 })

  // Re-analyzing fenB replays the cache synchronously; if the stale cp 99
  // line had leaked into the cache under fenB, this would replay it instead.
  const replay: EngineUpdate[] = []
  engine.analyze('fenB w - - 0 1', (u) => replay.push(u))
  expect(replay).toHaveLength(1)
  expect(replay[0].lines[0].eval).toEqual({ type: 'cp', value: 5 })
})

test('an interrupted search finishing with bestmove (none) does not emit a terminal update', async () => {
  const { engine, worker } = await setup()
  const updatesMate: EngineUpdate[] = []
  engine.analyze('8/8/8/8/8/6k1/6q1/6K1 w - - 0 1', (u) => updatesMate.push(u))

  const updatesB: EngineUpdate[] = []
  engine.analyze('fenB w - - 0 1', (u) => updatesB.push(u)) // interrupts before mate's bestmove arrives

  worker.emit('bestmove (none)') // the abandoned mate search's own terminal bestmove
  expect(updatesMate).toHaveLength(0) // must NOT be treated as a terminal update

  expect(worker.posted.at(-2)).toBe('position fen fenB w - - 0 1')
  expect(worker.posted.at(-1)).toBe('go movetime 8000')
})
