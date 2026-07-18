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
// ponytail: 12s ceiling (movetime 8000 + margin for the stop/isready
// round-trip) — a worker that silently drops a search (killed mid-flight, no
// error event) would otherwise leave `searching` true forever, since nothing
// else clears it without a bestmove. Raise if real-world hardware needs more
// slack.
const WATCHDOG_MS = 12_000

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
  // The fen the caller currently wants analysis for — updated on every
  // analyze() call regardless of whether a search is actually running for it
  // yet. Used for the per-fen cache lookup, and to resume the right position
  // on visibilitychange.
  private targetFen: string | null = null
  // The fen a `go` is ACTUALLY running for right now (set by startSearch,
  // cleared implicitly by the fact that `searching` goes false on bestmove).
  private currentFen: string | null = null
  // True from the moment `go` is posted until that search's `bestmove`
  // lands. UCI gives no per-search id, so this plus queuedFen below is how
  // we tell "line belongs to the live search" from "line belongs to one we
  // already abandoned".
  private searching = false
  // Design C — serialize on bestmove. Two earlier designs both broke against
  // the real worker:
  //  - A counter of bestmoves-to-swallow per interrupt: two interrupts before
  //    either stale bestmove arrived pushed the counter to 2 and nothing ever
  //    drained it again, permanently swallowing every future line (including
  //    the terminal `bestmove (none)` on checkmate — UI stuck on "Loading
  //    engine…").
  //  - An isready/readyok fence: measured against the actual wasm build
  //    (stockfish-18-lite-single.js), it does NOT answer `isready` while a
  //    search is running — posting stop+isready mid-search yields the
  //    interrupted search's bestmove but no readyok, repeatedly, for 3s+.
  //    The fence never lifts, so every line is dropped forever. Do not
  //    reintroduce a readyok-based gate in handleLine; readyok is only used
  //    once, in start()'s pre-search handshake, where it IS reliable.
  // The one thing the protocol reliably gives us is: a `bestmove` line
  // always arrives for a search, on movetime expiry or shortly after `stop`.
  // So queuedFen — the newest fen requested while a search is already running
  // — is only acted on when that search's bestmove shows up; nothing else
  // needs a timer, a counter, or a readyok.
  private queuedFen: string | null = null
  private lastEmit = 0
  private pending: EngineUpdate | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  // FIX 3: armed on every real `go`, cleared on bestmove/stop/dispose. If it
  // fires, that search's bestmove is presumed lost.
  private watchdog: ReturnType<typeof setTimeout> | null = null
  // FIX 3: set by the post-handshake worker `error` listener. Once true,
  // analyze()/startSearch() no-op instead of posting into a worker that will
  // never reply — the page's existing 'failed' status (set only from the
  // start() handshake) already covers the UI for a dead engine.
  private dead = false
  // The three MultiPV slots for the current search; rebuilt from scratch on
  // every startSearch() so a new position never shows the old position's
  // lines.
  private lineSlots: (EngineLine & { depth: number })[] = []
  private onVisibility = () => {
    if (!this.worker) return
    if (document.hidden) {
      this.worker.postMessage('stop')
    } else if (this.targetFen && this.onUpdate) {
      this.analyze(this.targetFen, this.onUpdate)
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
    // FIX 3: the handshake's own error listener is `once` and already
    // fired-or-removed by now — a worker abort AFTER the handshake (wasm
    // OOM, the tab's process getting killed) would otherwise go unobserved.
    worker.addEventListener('error', () => {
      this.dead = true
    })
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private startSearch(fen: string) {
    if (!this.worker || this.dead) return
    // FIX 2: a hidden tab already gets `stop` posted to its live search (see
    // onVisibility below), but nothing stopped a QUEUED search — one launched
    // from the bestmove handler below — from starting fresh in the
    // background, burning ~8s of wasm CPU nobody can see. targetFen already
    // holds this fen (analyze() sets it before ever calling startSearch, on
    // both the direct path and the path that queues one), so bailing here and
    // leaving `searching` false is enough: onVisibility's show-path calls
    // analyze(this.targetFen, ...), which re-enters startSearch once visible.
    if (typeof document !== 'undefined' && document.hidden) return
    this.currentFen = fen
    this.blackToMove = fen.split(' ')[1] === 'b'
    this.lineSlots = []
    this.searching = true
    this.queuedFen = null
    this.worker.postMessage(`position fen ${fen}`)
    // ponytail: movetime 8000 ceiling — deep enough for interactive analysis
    // without letting one position hang the worker; raise if users complain.
    this.worker.postMessage('go movetime 8000')
    this.armWatchdog()
  }

  private armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.onWatchdog(), WATCHDOG_MS)
  }

  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
  }

  // FIX 3: the search that was live when this timer was armed never reported
  // a bestmove. Treat it as lost — unwedge `searching` and move on to
  // whatever's next, same as a real bestmove would have.
  private onWatchdog() {
    this.watchdog = null
    if (!this.searching) return
    this.searching = false
    if (this.queuedFen !== null) {
      const next = this.queuedFen
      this.startSearch(next)
    } else if (this.currentFen) {
      this.startSearch(this.currentFen)
    }
  }

  private handleLine(line: string) {
    if (line.startsWith('bestmove')) {
      // FIX 4: a stray bestmove while idle (already-handled duplicate, or one
      // that arrives before any search ever started) must not resurrect
      // state — `bestmove (none)` here would schedule a terminal update
      // cached under whatever currentFen is left over from the LAST real
      // search, poisoning the cache for a non-terminal position.
      if (!this.searching) return
      this.clearWatchdog() // FIX 3: this search finished on its own, no rescue needed
      this.searching = false
      if (this.queuedFen !== null) {
        // This bestmove belongs to the search we already abandoned (queuedFen
        // was set the moment `stop` went out for it) — not a signal for
        // anyone still listening, just the starting gun for the real target.
        const next = this.queuedFen
        this.startSearch(next)
        return
      }
      // FIX 3: `bestmove (none)` means no legal moves (checkmate/stalemate).
      // No `info ... pv ...` line ever arrives for this position, so without
      // this EngineLines would show "Loading engine…" forever.
      if (line.startsWith('bestmove (none)')) this.schedule({ depth: 0, lines: [], terminal: true })
      return
    }
    // Belongs to a search we've moved past (either not searching at all, or
    // an interrupt is pending and this line predates the bestmove that will
    // launch the queued search) — drop it rather than risk caching/emitting
    // it under the wrong fen.
    if (!this.searching || this.queuedFen !== null || !this.onUpdate) return
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
    if (this.currentFen) this.cache.set(this.currentFen, u)
    this.onUpdate?.(u)
  }

  // stop -> position -> go movetime, the lichess ceval pattern (never `go
  // depth`, so a slow position doesn't stall the queue). ponytail: in-memory
  // Map only, cleared on reload — add IndexedDB if cross-session eval reuse
  // ever matters.
  analyze(fen: string, onUpdate: (u: EngineUpdate) => void): void {
    if (!this.worker || this.dead) return
    this.onUpdate = onUpdate
    this.targetFen = fen
    // Cancel any in-flight throttle timer left over from whatever was
    // searching before — otherwise it could fire later and deliver a stale
    // update (wrong fen's data) through `onUpdate`, which by then points at
    // THIS call's callback.
    this.lastEmit = 0
    this.pending = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    const cached = this.cache.get(fen)
    if (cached) onUpdate(cached)

    if (!this.searching) {
      this.startSearch(fen)
      return
    }
    // A search is already running. Only the newest target matters — the
    // user has already moved past whatever was queued before — so overwrite
    // queuedFen every time, but post `stop` only on the transition into
    // "interrupt pending" (once posted, the running search is already on its
    // way out; posting it again per analyze() call would just be a pile of
    // redundant stops).
    const alreadyInterrupting = this.queuedFen !== null
    this.queuedFen = fen
    if (!alreadyInterrupting) this.worker.postMessage('stop')
  }

  // Also drops targetFen/onUpdate so a later visibilitychange doesn't
  // restart a search on the abandoned position, and drops queuedFen so a
  // bestmove that's already in flight doesn't resurrect a search after an
  // explicit stop().
  stop(): void {
    this.worker?.postMessage('stop')
    this.onUpdate = null
    this.targetFen = null
    this.queuedFen = null
    // FIX 3: nobody's listening for this search's outcome anymore — don't
    // let the watchdog resurrect it (restart on currentFen) after an
    // explicit stop.
    this.clearWatchdog()
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.timer) clearTimeout(this.timer)
    this.clearWatchdog()
    this.worker?.terminate()
    this.worker = null
    this.onUpdate = null
    this.targetFen = null
  }
}
