// Browser-side Stockfish wrapper: a plain UCI worker, no framework deps.
// SSR-safe by construction — Worker/document are only touched inside methods
// (start/dispose), never at module scope, so importing this file on the
// server does nothing.
import type { Eval } from '@forked/shared'

export interface EngineUpdate {
  depth: number
  eval: Eval
  pvUci: string[]
}

const THROTTLE_MS = 125
const MIN_DEPTH = 10

// Parses one `info ...` UCI line into a White-perspective update, or null for
// anything that isn't an exact-score info line (bestmove/currmove/junk, and
// upper/lowerbound lines — those bracket the true score, not report it).
// UCI scores are relative to the side to move; negate for Black so the eval
// bar always reads White-positive, matching the shared Eval shape.
export function parseInfoLine(
  line: string,
  blackToMove: boolean,
): { depth: number; eval: Eval; pvUci: string[] } | null {
  if (!/^info\b/.test(line)) return null
  if (/\b(upperbound|lowerbound)\b/.test(line)) return null

  const depthM = /\bdepth (\d+)/.exec(line)
  const scoreM = /\bscore (cp|mate) (-?\d+)/.exec(line)
  const pvM = /\bpv (.+)$/.exec(line)
  if (!depthM || !scoreM || !pvM) return null

  const rawType = scoreM[1] as 'cp' | 'mate'
  const rawValue = Number(scoreM[2])
  const value = !blackToMove || rawValue === 0 ? rawValue : -rawValue

  return {
    depth: Number(depthM[1]),
    eval: { type: rawType, value } as Eval,
    pvUci: pvM[1].trim().split(/\s+/),
  }
}

// ponytail: MultiPV 1 only — one line, one arrow. Add MultiPV when a "show
// alternatives" UI actually asks for it.
export class LiveEngine {
  private worker: Worker | null = null
  private cache = new Map<string, EngineUpdate>()
  private blackToMove = false
  private onUpdate: ((u: EngineUpdate) => void) | null = null
  private lastFen: string | null = null
  private lastEmit = 0
  private pending: EngineUpdate | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  // Stale-line guard: after `analyze` interrupts a running search, the old
  // search still flushes info lines until its `bestmove` lands — without this
  // they'd be parsed with the NEW position's side-to-move and cached under
  // the NEW fen (wrong, possibly sign-flipped evals). `searching` = a `go`
  // is outstanding without its bestmove; each interrupt bumps the counter of
  // bestmoves to swallow before lines are trusted again.
  private searching = false
  private staleBestmoves = 0
  private onVisibility = () => {
    if (!this.worker) return
    if (document.hidden) {
      this.worker.postMessage('stop')
    } else if (this.lastFen && this.onUpdate) {
      this.analyze(this.lastFen, this.onUpdate)
    }
  }

  async start(): Promise<void> {
    const worker = new Worker('/engine/stockfish-18-lite-single.js')
    this.worker = worker
    await new Promise<void>((resolve, reject) => {
      function onLine(e: MessageEvent<string>) {
        if (e.data === 'uciok') worker.postMessage('isready')
        else if (e.data === 'readyok') {
          worker.removeEventListener('message', onLine)
          resolve()
        }
      }
      worker.addEventListener('message', onLine)
      // A worker script that 404s or fails to parse fires `error` async (the
      // constructor doesn't throw) — without this the promise hangs forever
      // and the caller's 'failed' state is unreachable.
      worker.addEventListener('error', (e) => reject(new Error(e.message || 'engine worker failed')), { once: true })
      worker.postMessage('uci')
    })
    worker.addEventListener('message', (e: MessageEvent<string>) => this.handleLine(e.data))
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private handleLine(line: string) {
    if (line.startsWith('bestmove')) {
      if (this.staleBestmoves > 0) this.staleBestmoves -= 1
      else this.searching = false
      return
    }
    if (this.staleBestmoves > 0) return // old search still draining
    if (!this.onUpdate) return
    const parsed = parseInfoLine(line, this.blackToMove)
    if (!parsed || parsed.depth < MIN_DEPTH) return
    this.schedule(parsed)
  }

  // Trailing-edge throttle: at most one emit per THROTTLE_MS, but the last
  // update in a burst always lands (lichess ceval pattern) instead of being
  // dropped at the window boundary.
  private schedule(u: EngineUpdate) {
    this.pending = u
    const now = Date.now()
    const elapsed = now - this.lastEmit
    if (elapsed >= THROTTLE_MS) {
      this.emit(u)
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        if (this.pending) this.emit(this.pending)
      }, THROTTLE_MS - elapsed)
    }
  }

  private emit(u: EngineUpdate) {
    this.lastEmit = Date.now()
    this.pending = null
    if (this.lastFen) this.cache.set(this.lastFen, u)
    this.onUpdate?.(u)
  }

  // stop -> position -> go movetime, the lichess ceval pattern (never `go
  // depth`, so a slow position doesn't stall the queue). ponytail: in-memory
  // Map only, cleared on reload — add IndexedDB if cross-session eval reuse
  // ever matters.
  analyze(fen: string, onUpdate: (u: EngineUpdate) => void): void {
    if (!this.worker) return
    this.blackToMove = fen.split(' ')[1] === 'b'
    this.onUpdate = onUpdate
    this.lastFen = fen
    this.lastEmit = 0
    this.pending = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    const cached = this.cache.get(fen)
    if (cached) onUpdate(cached)

    if (this.searching) this.staleBestmoves += 1
    this.searching = true
    this.worker.postMessage('stop')
    this.worker.postMessage(`position fen ${fen}`)
    // ponytail: movetime 8000 ceiling — deep enough for interactive analysis
    // without letting one position hang the worker; raise if users complain.
    this.worker.postMessage('go movetime 8000')
  }

  // Also drops lastFen/onUpdate so a later visibilitychange doesn't restart
  // a search on the abandoned position.
  stop(): void {
    this.worker?.postMessage('stop')
    this.onUpdate = null
    this.lastFen = null
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.timer) clearTimeout(this.timer)
    this.worker?.terminate()
    this.worker = null
    this.onUpdate = null
    this.lastFen = null
  }
}
