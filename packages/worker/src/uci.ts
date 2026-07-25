import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { parseUciInfo, sideToMove, type Eval, type UciInfo } from '@forked/shared'

export class EngineTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineTimeoutError'
  }
}

// Hash size is part of the determinism contract AND therefore implicitly
// part of the cache-key contract: records analyzed at different hash sizes
// would collide under the same content address. It is deliberately not
// configurable.
const HASH_MB = 64

// First spawn in a fresh Lambda sandbox pages the engine binary in over
// the network (lazy container-image loading); uciok can take >10s cold.
// Normal case is milliseconds, so a generous ceiling costs nothing.
const BOOT_TIMEOUT_MS = 60_000

export interface EngineOptions {
  enginePath?: string
  respawnAfterGames?: number
}

export interface PositionAnalysis {
  eval: Eval
  best: string
  pv: string[]
}

interface Waiter {
  resolve: (line: string) => void
  reject: (err: Error) => void
  predicate: (line: string) => boolean
  onLine?: (line: string) => void
  timer: NodeJS.Timeout
}

// One Stockfish process, driven over UCI via stdin/stdout, reused across
// games and proactively respawned every `respawnAfterGames` games. All UCI
// traffic is strictly sequential: one command sequence in flight at a time.
export class Engine {
  version = 'unknown'
  spawnCount = 0
  private proc: ChildProcess | null = null
  private rl: Interface | null = null
  private waiter: Waiter | null = null
  private gamesSinceSpawn = 0
  private readonly path: string
  private readonly respawnAfterGames: number

  private constructor(opts: EngineOptions) {
    this.path = opts.enginePath ?? process.env.STOCKFISH_PATH ?? 'stockfish'
    this.respawnAfterGames = opts.respawnAfterGames ?? 50
  }

  static async start(opts: EngineOptions = {}): Promise<Engine> {
    const engine = new Engine(opts)
    await engine.boot()
    return engine
  }

  private async boot(): Promise<void> {
    const proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'ignore'] })
    this.proc = proc
    this.spawnCount += 1
    this.gamesSinceSpawn = 0
    this.rl = createInterface({ input: proc.stdout! })
    this.rl.on('line', (line) => this.handleLine(line))
    proc.on('error', (err) => this.failWaiter(err))
    proc.on('close', () => this.failWaiter(new Error('engine process exited')))

    this.send('uci')
    await this.waitFor((l) => l === 'uciok', BOOT_TIMEOUT_MS, 'uciok', (l) => {
      if (l.startsWith('id name ')) this.version = l.slice('id name '.length).trim()
    })
    // Determinism contract: single thread, fixed hash, MultiPV 2, node-count
    // search limits only. Depth and movetime limits are forbidden; both are
    // non-deterministic across hardware.
    this.send('setoption name Threads value 1')
    this.send(`setoption name Hash value ${HASH_MB}`)
    this.send('setoption name MultiPV value 2')
    await this.ready(BOOT_TIMEOUT_MS)
  }

  // Analysis of a game always starts from ucinewgame (which clears the hash
  // table); carryover BETWEEN positions within one game is intentional and
  // part of the determinism contract.
  async newGame(): Promise<void> {
    if (this.gamesSinceSpawn >= this.respawnAfterGames) await this.respawn()
    this.gamesSinceSpawn += 1
    this.send('ucinewgame')
    await this.ready(10_000)
  }

  // Evaluates the position after `moves` from the start position, spending
  // exactly `nodes` search nodes. Returns the evaluation normalized to
  // White's perspective, the engine's best move, and the principal variation
  // trimmed to 6 plies. The watchdog covers the whole position: on trip the
  // engine process is killed and EngineTimeoutError is thrown.
  async analyzePosition(moves: readonly string[], nodes: number, watchdogMs = 30_000): Promise<PositionAnalysis> {
    this.send(moves.length ? `position startpos moves ${moves.join(' ')}` : 'position startpos')
    this.send(`go nodes ${nodes}`)

    let exact: UciInfo | null = null
    let bound: UciInfo | null = null
    const bestLine = await this.waitFor(
      (l) => l.startsWith('bestmove '),
      watchdogMs,
      `bestmove after ${moves.length} plies`,
      (l) => {
        const info = parseUciInfo(l, sideToMove(moves.length))
        if (!info) return
        if (info.multipv !== 1) return
        // Aspiration-window re-searches emit lowerbound/upperbound lines; a
        // node-limit stop can leave one as the final line. Prefer the last
        // EXACT score, falling back to a bound only if no exact line came.
        if (info.bound) bound = info
        else exact = info
      },
    )

    // The casts re-widen after the closure writes above; TS control-flow
    // analysis cannot see assignments made inside the onLine callback.
    const found = (exact ?? bound) as UciInfo | null
    if (!found) throw new Error('engine sent bestmove without any scored info line')
    // Normalization to White's perspective now happens inside parseUciInfo.
    return {
      eval: found.eval,
      best: bestLine.split(/\s+/)[1],
      pv: found.pv.slice(0, 6),
    }
  }

  async respawn(): Promise<void> {
    this.dispose()
    await this.boot()
  }

  dispose(): void {
    this.rl?.close()
    this.rl = null
    if (this.waiter) {
      clearTimeout(this.waiter.timer)
      this.waiter = null
    }
    this.proc?.removeAllListeners()
    this.proc?.kill('SIGKILL')
    this.proc = null
  }

  private async ready(timeoutMs: number): Promise<void> {
    this.send('isready')
    await this.waitFor((l) => l === 'readyok', timeoutMs, 'readyok')
  }

  private send(cmd: string): void {
    this.proc?.stdin?.write(`${cmd}\n`)
  }

  private waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    label: string,
    onLine?: (line: string) => void,
  ): Promise<string> {
    if (this.waiter) return Promise.reject(new Error('engine already has a command in flight'))
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null
        // Watchdog trip: kill the process; the caller respawns and retries.
        this.proc?.removeAllListeners()
        this.proc?.kill('SIGKILL')
        reject(new EngineTimeoutError(`engine timed out after ${timeoutMs}ms waiting for ${label}`))
      }, timeoutMs)
      this.waiter = { predicate, resolve, reject, onLine, timer }
    })
  }

  private handleLine(line: string): void {
    const w = this.waiter
    if (!w) return
    w.onLine?.(line)
    if (w.predicate(line)) {
      clearTimeout(w.timer)
      this.waiter = null
      w.resolve(line)
    }
  }

  private failWaiter(err: Error): void {
    const w = this.waiter
    if (!w) return
    clearTimeout(w.timer)
    this.waiter = null
    w.reject(err)
  }
}
