// Pure decision logic for the game-review page (packages/web/src/app/j/[jobId]/g/[gameId]/page.tsx),
// lifted out so it has a test surface independent of mounting the page. The
// useState/useEffect wiring, the polling effect, and the live-engine effects
// deliberately stay in the page — only the branch-free decisions moved here.
import type { Enriched, EngineRecord, Eval, PlyAnalysis } from '@forked/shared'
import { fenBeforePly } from '@forked/shared'
import type { EngineUpdate } from './engine'
import { terminalEval } from './moves'
import { tierTint } from '../components/classification'

// Live branch mode: a free-play branch off the mainline. `base` plies of the
// mainline stay fixed once the branch starts; `moves` grows from there.
export interface Branch {
  base: number
  moves: string[]
}

// The last reading the live engine produced for a specific position — held by
// the page in a ref, and read by shownEval to bridge the gap before a new
// search lands. Named here so the page and shownEval share one shape.
export interface LastLive {
  fen: string
  eval: Eval
  bestUci: string | null
}

// Plain +/-1 stepping, shared by the toolbar buttons and the arrow-key
// handler. ArrowLeft from move 1 steps to the start position (null).
export function stepTo(current: number | null, dir: 1 | -1, total: number): number | null {
  return dir === 1 ? Math.min(total, (current ?? 0) + 1) : current === null || current <= 1 ? null : current - 1
}

// Game-performance rating estimated from move accuracy. Heuristic power fit,
// exponent 5, recalibrated against a real chess.com Game Review side-by-side
// (Apertito vs Akshx999, 17 Jul 26): 64.7% -> ~350, 57% -> ~190 matched
// chess.com's 500/150; 90% -> ~1830, 99% -> ~2950 anchor the top end.
// ponytail: accuracy-only estimate; blend in opponent rating and game length
// if it ever needs to be defensible.
export function estimatedElo(accuracy: number): number {
  const elo = 3100 * Math.pow(Math.min(accuracy, 100) / 100, 5)
  return Math.max(100, Math.round(elo / 10) * 10)
}

// The branch's own live fen — base mainline plies plus the branch's own
// moves.
export function branchFen(record: EngineRecord, branch: Branch): string {
  return fenBeforePly(
    [...record.uciMoves.slice(0, branch.base), ...branch.moves],
    branch.base + branch.moves.length + 1,
  )
}

// FIX 1b: the branch position one ply back — the parent of the LAST branch
// move — used below to find a still-valid live eval while the new
// position's own search hasn't produced one yet. Same fenBeforePly(array,
// array.length + 1) pattern as branchFen above, just one move shorter.
export function branchParentFen(record: EngineRecord, branch: Branch): string {
  return fenBeforePly(
    [...record.uciMoves.slice(0, branch.base), ...branch.moves.slice(0, -1)],
    branch.base + branch.moves.length,
  )
}

// The eval shown on the bar: the live engine's read of the shown position,
// once it has one. Otherwise (no live update yet, or engine failed) the
// latest non-null stored eval at or before the selected ply (terminal
// mate/stalemate plies store null), else the start.
export function shownEval(args: {
  record: EngineRecord
  selected: number | null
  branch: Branch | null
  fen: string
  liveUpdate: EngineUpdate | null
  lastLive: LastLive | null
  branchParentFen: string | null
}): Eval {
  const { record, selected, branch, fen, liveUpdate, lastLive, branchParentFen } = args
  // FIX 3: a terminal update has no lines[0] — fall through to the stored
  // eval instead of crashing on liveUpdate.lines[0].eval.
  if (liveUpdate?.lines[0]) {
    return liveUpdate.lines[0].eval
  } else if (branch && liveUpdate?.terminal) {
    // FIX 1a: the mainline stored-eval fallback below is for `selected`'s
    // position (the branch BASE) — showing it here would put a stale eval on
    // the bar permanently, contradicting a mated/stalemated branch position.
    // `fen` already equals the branch's own position (shownFen resolves to
    // branchFen while a branch is active), so read the eval off it directly.
    return terminalEval(fen) ?? { type: 'cp', value: 0 }
  } else if (branch && !liveUpdate && lastLive?.fen === branchParentFen) {
    // FIX 1b: the engine hasn't produced an update for the new branch
    // position yet — hold the last real eval it produced for the position
    // one branch-move back, instead of snapping to the mainline base's
    // stored eval (a different position N branch-moves shallower).
    return lastLive.eval
  } else {
    let ev = record.startEval
    if (selected !== null) {
      for (let i = selected - 1; i >= 0; i--) {
        const e = record.plies[i]?.evalAfter
        if (e) {
          ev = e
          break
        }
      }
    }
    return ev
  }
}

// Board overlays (badge/last-move/tint/arrows) for the shown position — branch
// mode reads the live judgment of the last branch move; mainline mode reads
// the stored classification and Stockfish's recommendation for the ply.
export function boardDecorations(args: {
  branch: Branch | null
  branchBadge: { square: string; kind: Enriched } | null
  liveUpdate: EngineUpdate | null
  ply: PlyAnalysis | null
  tier: Enriched
}): {
  badge?: { square: string; kind: Enriched }
  lastMove?: { from: string; to: string }
  tint?: string
  arrows?: { from: string; to: string; color: string }[]
} {
  const { branch, branchBadge, liveUpdate, ply, tier } = args
  let badge: { square: string; kind: Enriched } | undefined
  let lastMove: { from: string; to: string } | undefined
  let tint: string | undefined
  let arrows: { from: string; to: string; color: string }[] | undefined

  if (branch) {
    // Badge is the live judgment of the last branch move (see the judging
    // effect above), resolved once depth >= 12 lands — undefined (no badge,
    // no tint override) until then, which falls back to Board's default
    // neutral yellow last-move glow.
    const last = branch.moves[branch.moves.length - 1]
    if (last) lastMove = { from: last.slice(0, 2), to: last.slice(2, 4) }
    badge = branchBadge ?? undefined
    tint = branchBadge ? tierTint(branchBadge.kind) : undefined
    if (liveUpdate?.lines[0]?.pvUci[0]) {
      const pv0 = liveUpdate.lines[0].pvUci[0]
      arrows = [{ from: pv0.slice(0, 2), to: pv0.slice(2, 4), color: 'var(--best)' }]
    }
  } else if (ply) {
    const dest = ply.played.slice(2, 4)
    badge = tier !== 'none' ? { square: dest, kind: tier } : undefined
    lastMove = { from: ply.played.slice(0, 2), to: dest }
    tint = tier !== 'none' ? tierTint(tier) : undefined
    // Stockfish's recommendation on every ply where something better existed
    // (not just the bad tiers) — book moves excepted, and no arrow when the
    // played move already was the best one.
    if (ply.best !== ply.played && !ply.book) {
      arrows = [{ from: ply.best.slice(0, 2), to: ply.best.slice(2, 4), color: 'var(--best)' }]
    }
  }

  return { badge, lastMove, tint, arrows }
}

// The `playUserMove` predicate for "this is just the mainline moving
// forward" (as opposed to starting/extending a branch).
export function isMainlineStep(record: EngineRecord, selected: number | null, branch: Branch | null, uci: string): boolean {
  return !branch && uci === record.uciMoves[selected ?? 0]
}
