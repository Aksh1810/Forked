import type { Eval } from './schemas.js'

// The UCI `info` line, parsed. Two engines are driven in this codebase — a
// child process in the worker and a wasm Worker in the browser — and both used
// to carry their own regexes and their own copy of the side-to-move sign flip.
// The protocol is the same on both sides of that seam, so it is parsed here
// and nowhere else; what differs (transport, MultiPV width, search limits, how
// long to wait) stays in the callers.
export interface UciInfo {
  // Absent on some engine builds' early lines; callers that need a depth
  // filter check for null themselves.
  depth: number | null
  // Defaults to 1 when the engine omits it (MultiPV 1 searches).
  multipv: number
  // Already normalized to White's perspective (see below).
  eval: Eval
  // Empty when the line reports a score but no principal variation.
  pv: string[]
  // Aspiration-window re-searches emit lowerbound/upperbound lines. These
  // bracket the true score rather than reporting it, so a caller either
  // discards them or keeps them only as a fallback.
  bound: boolean
}

const SCORE_RE = /\bscore (cp|mate) (-?\d+)/
const DEPTH_RE = /\bdepth (\d+)/
const MULTIPV_RE = /\bmultipv (\d+)/
const PV_RE = /\bpv (.+)$/

// Parses one line of engine output. Returns null for anything that is not a
// scored `info` line — bestmove, currmove, id, junk.
//
// UCI reports scores from the side to move's perspective; every consumer in
// this codebase wants White's. The flip happens here, once, and nowhere else.
// Zero is returned unflipped so an equal position never renders as -0.
export function parseUciInfo(line: string, sideToMove: 'white' | 'black'): UciInfo | null {
  if (!/^info\b/.test(line)) return null

  const score = SCORE_RE.exec(line)
  if (!score) return null

  const raw = Number(score[2])
  const value = sideToMove === 'white' || raw === 0 ? raw : -raw
  const depth = DEPTH_RE.exec(line)
  const multipv = MULTIPV_RE.exec(line)
  const pv = PV_RE.exec(line)

  return {
    depth: depth ? Number(depth[1]) : null,
    multipv: multipv ? Number(multipv[1]) : 1,
    eval: { type: score[1] as 'cp' | 'mate', value } as Eval,
    pv: pv ? pv[1].trim().split(/\s+/) : [],
    bound: /\b(lowerbound|upperbound)\b/.test(line),
  }
}

// Side to move after `plies` half-moves from the start position. Both engine
// callers need it to ask for the White-perspective flip.
export function sideToMove(plies: number): 'white' | 'black' {
  return plies % 2 === 0 ? 'white' : 'black'
}
