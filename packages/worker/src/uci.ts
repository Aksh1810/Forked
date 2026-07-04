import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import type { Eval } from '@blunderfarm/shared'

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

const SCORE_RE = / score (cp|mate) (-?\d+)/
const MULTIPV_RE = / multipv (\d+)/

interface ScoredInfo {
  kind: 'cp' | 'mate'
  value: number
  pv: string[]
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
    await this.waitFor((l) => l === 'uciok', 10_000, 'uciok', (l) => {
      if (l.startsWith('id name ')) this.version = l.slice('id name '.length).trim()
    })
    // Determinism contract: single thread, fixed hash, MultiPV 2, node-count
    // search limits only. Depth and movetime limits are forbidden; both are
    // non-deterministic across hardware.
    this.send('setoption name Threads value 1')
    this.send(`setoption name Hash value ${HASH_MB}`)
    this.send('setoption name MultiPV value 2')
    await this.ready(10_000)
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
    const whiteToMove = moves.length % 2 === 0
    this.send(moves.length ? `position startpos moves ${moves.join(' ')}` : 'position startpos')
    this.send(`go nodes ${nodes}`)

    let exact: ScoredInfo | null = null
    let bound: ScoredInfo | null = null
    const bestLine = await this.waitFor(
      (l) => l.startsWith('bestmove '),
      watchdogMs,
      `bestmove after ${moves.length} plies`,
      (l) => {
        if (!l.startsWith('info ')) return
        const score = SCORE_RE.exec(l)
        if (!score) return
        const multipv = MULTIPV_RE.exec(l)
        if (multipv && multipv[1] !== '1') return
        const info: ScoredInfo = {
          kind: score[1] as 'cp' | 'mate',
          value: Number(score[2]),
          pv: l.split(' pv ')[1]?.trim().split(/\s+/) ?? [],
        }
        // Aspiration-window re-searches emit lowerbound/upperbound lines; a
        // node-limit stop can leave one as the final line. Prefer the last
        // EXACT score, falling back to a bound only if no exact line came.
        if (l.includes(' lowerbound') || l.includes(' upperbound')) bound = info
        else exact = info
      },
    )

    // The casts re-widen after the closure writes above; TS control-flow
    // analysis cannot see assignments made inside the onLine callback.
    const found = (exact ?? bound) as ScoredInfo | null
    if (!found) throw new Error('engine sent bestmove without any scored info line')
    // UCI scores are from the side to move's perspective; normalize to
    // White's perspective here, at the wrapper boundary, and nowhere else.
    const sign = whiteToMove ? 1 : -1
    return {
      eval:
        found.kind === 'cp'
          ? { type: 'cp', value: sign * found.value }
          : { type: 'mate', value: sign * found.value },
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
