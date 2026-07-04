import {
  EngineRecordSchema,
  cacheKey,
  classifyWinPctSwing,
  finalStatus,
  matchOpening,
  moverWinPct,
  type EngineRecord,
  type Eval,
  type PlyAnalysis,
} from '@blunderfarm/shared'
import { Engine, EngineTimeoutError } from './uci.js'

export const DEFAULT_NODE_BUDGET = 600_000
// Bounded range for per-job budget configuration; ingest enforces it.
export const MIN_NODE_BUDGET = 100_000
export const MAX_NODE_BUDGET = 2_000_000

export interface AnalyzeOptions {
  nodeBudget?: number
  watchdogMs?: number
}

// Analyzes one game into a content-addressed engine record. Positions are
// evaluated sequentially from ply 1 (hash carryover between positions within
// one game is intentional). A watchdog trip kills and respawns the engine and
// retries the WHOLE game once from scratch, never mid-game; a second trip
// propagates to the failure path.
export async function analyzeGame(
  engine: Engine,
  uciMoves: readonly string[],
  opts: AnalyzeOptions = {},
): Promise<EngineRecord> {
  const nodeBudget = opts.nodeBudget ?? DEFAULT_NODE_BUDGET
  const watchdogMs = opts.watchdogMs ?? 30_000
  const terminal = finalStatus(uciMoves)
  const bookPlies = matchOpening(uciMoves)?.plies ?? 0
  // Book positions get 25 percent of the budget: their plies are excluded
  // from classification, so full-depth evals there buy nothing.
  const bookBudget = Math.max(1, Math.round(nodeBudget / 4))

  const attempt = async (): Promise<EngineRecord> => {
    await engine.newGame()
    const n = uciMoves.length
    const evals: Eval[] = []
    const bests: string[] = []
    const pvs: string[][] = []
    for (let j = 0; j <= n; j++) {
      if (j === n && terminal !== null) break
      const r = await engine.analyzePosition(
        uciMoves.slice(0, j),
        j < bookPlies ? bookBudget : nodeBudget,
        watchdogMs,
      )
      evals.push(r.eval)
      bests.push(r.best)
      pvs.push(r.pv)
    }

    const plies: PlyAnalysis[] = []
    for (let i = 1; i <= n; i++) {
      const mover = i % 2 === 1 ? 'white' : 'black'
      const book = i <= bookPlies
      const isTerminalPly = i === n && terminal !== null
      const wpBefore = moverWinPct(evals[i - 1], mover)
      const wpAfter = isTerminalPly
        ? terminal === 'checkmate'
          ? 100 // delivering mate; being mated is impossible, the mover just moved
          : 50
        : moverWinPct(evals[i], mover)
      plies.push({
        ply: i,
        played: uciMoves[i - 1],
        best: bests[i - 1],
        pv: pvs[i - 1],
        evalAfter: isTerminalPly ? null : evals[i],
        classification: book ? 'none' : classifyWinPctSwing(wpBefore, wpAfter),
        book,
      })
    }

    return EngineRecordSchema.parse({
      cacheKey: cacheKey(uciMoves, engine.version, nodeBudget),
      engineVersion: engine.version,
      nodeBudget,
      uciMoves: [...uciMoves],
      startEval: evals[0],
      plies,
    })
  }

  try {
    return await attempt()
  } catch (err) {
    if (!(err instanceof EngineTimeoutError)) throw err
    await engine.respawn()
    try {
      return await attempt()
    } catch (err2) {
      if (err2 instanceof EngineTimeoutError) {
        // Leave the engine healthy for the next game before failing this one.
        await engine.respawn().catch(() => {})
      }
      throw err2
    }
  }
}
