// Browser-side Stockfish wrapper: a plain UCI worker, no framework deps.
// SSR-safe by construction — Worker/document are only touched inside methods
// (start/dispose), never at module scope, so importing this file on the
// server does nothing.
import type { Eval } from '@forked/shared'

export interface EngineLine {
  eval: Eval
  pvUci: string[]
}

export interface EngineUpdate {
  depth: number
  lines: EngineLine[] // lines[0] is the best line; up to 3 (MultiPV)
  // FIX 3: set when Stockfish reports `bestmove (none)` for the CURRENT
  // search — a checkmated/stalemated position, which never has a `pv` line
  // for parseInfoLine to pick up, so this is the only terminal signal there
  // is. `lines` is always empty on a terminal update.
  terminal?: boolean
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
): { depth: number; multipv: number; eval: Eval; pvUci: string[] } | null {
  if (!/^info\b/.test(line)) return null
  if (/\b(upperbound|lowerbound)\b/.test(line)) return null

  const depthM = /\bdepth (\d+)/.exec(line)
  const scoreM = /\bscore (cp|mate) (-?\d+)/.exec(line)
  const pvM = /\bpv (.+)$/.exec(line)
  if (!depthM || !scoreM || !pvM) return null

  const multipvM = /\bmultipv (\d+)/.exec(line)
  const rawType = scoreM[1] as 'cp' | 'mate'
  const rawValue = Number(scoreM[2])
  const value = !blackToMove || rawValue === 0 ? rawValue : -rawValue

  return {
    depth: Number(depthM[1]),
    multipv: multipvM ? Number(multipvM[1]) : 1,
    eval: { type: rawType, value } as Eval,
    pvUci: pvM[1].trim().split(/\s+/),
  }
}

export class LiveEngine {
  private worker: Worker | null = null
  private cache = new Map<string, EngineUpdate>()
  private blackToMove = false
  private onUpdate: ((u: EngineUpdate) => void) | null = null
  private lastFen: string | null = null
  private lastEmit = 0
  private pending: EngineUpdate | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  // The three MultiPV slots for the current search; rebuilt from scratch on
  // every analyze() so a new position never shows the old position's lines.
  private lineSlots: (EngineLine & { depth: number })[] = []
  // Fence guard: after `analyze` posts `stop`, the interrupted search can
  // still flush info/bestmove lines for a while — without this they'd be
  // parsed with the NEW position's side-to-move and cached under the NEW
  // fen (wrong, possibly sign-flipped evals). UCI has no per-search id, but
  // `isready`/`readyok` is a hard barrier: everything the worker emits
  // before OUR `readyok` belongs to a stale search, full stop. This used to
  // be a counter of bestmoves-to-swallow, one per interrupt, but that broke
  // the moment two interrupts landed before either stale search's bestmove
  // arrived — the counter reached 2 and nothing ever drained it again,
  // permanently swallowing every future line (including the terminal
  // `bestmove (none)` on checkmate). The fence has no such failure mode: it
  // only ever waits for the ONE readyok that answers the LATEST isready.
  private fenced = false
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
        if (e.data === 'uciok') {
          worker.postMessage('setoption name MultiPV value 3')
          worker.postMessage('isready')
        } else if (e.data === 'readyok') {
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
    if (line === 'readyok') {
      this.fenced = false
      // Every analyze() call posts its own stop+isready pair, so a rapid
      // string of interrupts can queue several isready's before any of
      // their readyok's come back. Each readyok that lands re-posts
      // whatever `lastFen` is RIGHT NOW — i.e. the latest request — so an
      // extra stale readyok just restarts the same (already-latest) search
      // again. Wasteful, never wrong. ponytail: not worth a second counter
      // to suppress it — that's the exact failure mode this fence replaces.
      if (this.worker && this.lastFen) {
        this.worker.postMessage(`position fen ${this.lastFen}`)
        // ponytail: movetime 8000 ceiling — deep enough for interactive
        // analysis without letting one position hang the worker; raise if
        // users complain.
        this.worker.postMessage('go movetime 8000')
      }
      return
    }
    if (this.fenced) return // belongs to a search that predates our readyok
    if (line.startsWith('bestmove')) {
      // FIX 3: `bestmove (none)` means no legal moves (checkmate/stalemate).
      // No `info ... pv ...` line ever arrives for this position, so without
      // this EngineLines would show "Loading engine…" forever.
      if (line.startsWith('bestmove (none)')) this.schedule({ depth: 0, lines: [], terminal: true })
      return
    }
    if (!this.onUpdate) return
    const parsed = parseInfoLine(line, this.blackToMove)
    if (!parsed || parsed.depth < MIN_DEPTH) return
    this.lineSlots[parsed.multipv - 1] = { eval: parsed.eval, pvUci: parsed.pvUci, depth: parsed.depth }
    const first = this.lineSlots[0]
    if (!first) return // never emit an update without the best line
    this.schedule({
      depth: first.depth,
      lines: this.lineSlots.filter(Boolean).map((l) => ({ eval: l.eval, pvUci: l.pvUci })),
    })
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
    this.lineSlots = []

    const cached = this.cache.get(fen)
    if (cached) onUpdate(cached)

    // Fence the old search out: stop only matters if a search is running
    // (harmless otherwise), and isready's readyok is the barrier — nothing
    // the worker emits before it is trusted. handleLine() posts the actual
    // `position`/`go` for whatever fen is latest once readyok arrives, so a
    // burst of analyze() calls before that only ever searches the last one.
    this.fenced = true
    this.worker.postMessage('stop')
    this.worker.postMessage('isready')
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
