import { expect, test } from 'vitest'
import { fenBeforePly, type EngineRecord, type Eval, type PlyAnalysis } from '@forked/shared'
import type { EngineUpdate } from '../src/lib/engine.js'
import {
  boardDecorations,
  branchFen,
  branchParentFen,
  estimatedElo,
  isMainlineStep,
  shownEval,
  stepTo,
  type Branch,
} from '../src/lib/review-session.js'

const CP = (v: number): Eval => ({ type: 'cp', value: v })

function ply(n: number, overrides: Partial<PlyAnalysis> = {}): PlyAnalysis {
  return {
    ply: n,
    played: 'e2e4',
    best: 'e2e4',
    pv: [],
    evalAfter: CP(0),
    classification: 'none',
    book: false,
    ...overrides,
  }
}

function makeRecord(uciMoves: string[], plies: PlyAnalysis[]): EngineRecord {
  return {
    cacheKey: 'test',
    engineVersion: 'test',
    nodeBudget: 1,
    uciMoves,
    startEval: CP(20),
    plies,
  }
}

// --- shownEval ---

test('shownEval: live update present wins over everything else', () => {
  const record = makeRecord(['e2e4'], [ply(1, { evalAfter: CP(10) })])
  const liveUpdate: EngineUpdate = { depth: 15, lines: [{ eval: CP(55), pvUci: ['e7e5'] }] }
  const ev = shownEval({
    record,
    selected: 1,
    branch: null,
    fen: 'irrelevant',
    liveUpdate,
    lastLive: null,
    branchParentFen: null,
  })
  expect(ev).toEqual(CP(55))
})

test('shownEval: branch + terminal live update uses terminalEval of the branch fen', () => {
  const record = makeRecord(['e2e4'], [ply(1)])
  const branch: Branch = { base: 1, moves: ['h4h2'] }
  // Fool's-mate-shaped mate: white to move, checkmated -> black delivered it.
  const matedFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
  const liveUpdate: EngineUpdate = { depth: 0, lines: [], terminal: true }
  const ev = shownEval({
    record,
    selected: 1,
    branch,
    fen: matedFen,
    liveUpdate,
    lastLive: null,
    branchParentFen: null,
  })
  expect(ev).toEqual({ type: 'mate', value: -1 })
})

test('shownEval: branch with no live update but a matching branchParentFen holds the last live eval', () => {
  const record = makeRecord(['e2e4'], [ply(1)])
  const branch: Branch = { base: 1, moves: ['g8f6'] }
  const lastLive = { fen: 'parent-fen', eval: CP(42), bestUci: 'g1f3' }
  const ev = shownEval({
    record,
    selected: 1,
    branch,
    fen: 'child-fen',
    liveUpdate: null,
    lastLive,
    branchParentFen: 'parent-fen',
  })
  expect(ev).toEqual(CP(42))
})

test('shownEval: stored-eval walk-back skips null evalAfter plies and falls through to record.startEval', () => {
  const record = makeRecord(
    ['e2e4', 'e7e5', 'g1f3'],
    [ply(1, { evalAfter: null }), ply(2, { evalAfter: null }), ply(3, { evalAfter: null })],
  )
  const ev = shownEval({
    record,
    selected: 3,
    branch: null,
    fen: 'irrelevant',
    liveUpdate: null,
    lastLive: null,
    branchParentFen: null,
  })
  expect(ev).toEqual(record.startEval)
})

test('shownEval: selected === null yields startEval', () => {
  const record = makeRecord(['e2e4'], [ply(1, { evalAfter: CP(99) })])
  const ev = shownEval({
    record,
    selected: null,
    branch: null,
    fen: 'irrelevant',
    liveUpdate: null,
    lastLive: null,
    branchParentFen: null,
  })
  expect(ev).toEqual(record.startEval)
})

// --- boardDecorations ---

test('boardDecorations: branch mode with no branchBadge yet has no badge/tint but keeps lastMove', () => {
  const branch: Branch = { base: 2, moves: ['g1f3', 'b8c6'] }
  const d = boardDecorations({ branch, branchBadge: null, liveUpdate: null, ply: null, tier: 'none' })
  expect(d.badge).toBeUndefined()
  expect(d.tint).toBeUndefined()
  expect(d.lastMove).toEqual({ from: 'b8', to: 'c6' })
})

test('boardDecorations: branch mode with a branchBadge sets badge and tint', () => {
  const branch: Branch = { base: 2, moves: ['g1f3'] }
  const d = boardDecorations({
    branch,
    branchBadge: { square: 'f3', kind: 'best' },
    liveUpdate: null,
    ply: null,
    tier: 'none',
  })
  expect(d.badge).toEqual({ square: 'f3', kind: 'best' })
  expect(d.tint).toBeDefined()
})

test('boardDecorations: branch mode live pv produces the best arrow', () => {
  const branch: Branch = { base: 2, moves: ['g1f3'] }
  const liveUpdate: EngineUpdate = { depth: 15, lines: [{ eval: CP(20), pvUci: ['b8c6', 'f1c4'] }] }
  const d = boardDecorations({ branch, branchBadge: null, liveUpdate, ply: null, tier: 'none' })
  expect(d.arrows).toEqual([{ from: 'b8', to: 'c6', color: 'var(--best)' }])
})

test('boardDecorations: mainline "none" tier yields no badge/tint but keeps lastMove', () => {
  const p = ply(1, { played: 'e2e4', best: 'e2e4' })
  const d = boardDecorations({ branch: null, branchBadge: null, liveUpdate: null, ply: p, tier: 'none' })
  expect(d.badge).toBeUndefined()
  expect(d.tint).toBeUndefined()
  expect(d.lastMove).toEqual({ from: 'e2', to: 'e4' })
})

test('boardDecorations: mainline non-"none" tier badges the destination square', () => {
  const p = ply(1, { played: 'e2e4', best: 'd2d4' })
  const d = boardDecorations({ branch: null, branchBadge: null, liveUpdate: null, ply: p, tier: 'blunder' })
  expect(d.badge).toEqual({ square: 'e4', kind: 'blunder' })
  expect(d.tint).toBeDefined()
})

test('boardDecorations: no arrow when best === played', () => {
  const p = ply(1, { played: 'e2e4', best: 'e2e4' })
  const d = boardDecorations({ branch: null, branchBadge: null, liveUpdate: null, ply: p, tier: 'good' })
  expect(d.arrows).toBeUndefined()
})

test('boardDecorations: no arrow when ply.book is true', () => {
  const p = ply(1, { played: 'e2e4', best: 'd2d4', book: true })
  const d = boardDecorations({ branch: null, branchBadge: null, liveUpdate: null, ply: p, tier: 'good' })
  expect(d.arrows).toBeUndefined()
})

test('boardDecorations: arrow when best differs from played and not book', () => {
  const p = ply(1, { played: 'e2e4', best: 'd2d4', book: false })
  const d = boardDecorations({ branch: null, branchBadge: null, liveUpdate: null, ply: p, tier: 'good' })
  expect(d.arrows).toEqual([{ from: 'd2', to: 'd4', color: 'var(--best)' }])
})

// --- branchFen / branchParentFen ---

test('branchFen agrees with a direct fenBeforePly call on the same slices', () => {
  const record = makeRecord(['e2e4', 'e7e5'], [ply(1), ply(2)])
  const branch: Branch = { base: 2, moves: ['g1f3', 'b8c6'] }
  const expected = fenBeforePly(
    [...record.uciMoves.slice(0, branch.base), ...branch.moves],
    branch.base + branch.moves.length + 1,
  )
  expect(branchFen(record, branch)).toBe(expected)
})

test('branchParentFen agrees with a direct fenBeforePly call one move shorter', () => {
  const record = makeRecord(['e2e4', 'e7e5'], [ply(1), ply(2)])
  const branch: Branch = { base: 2, moves: ['g1f3', 'b8c6'] }
  const expected = fenBeforePly(
    [...record.uciMoves.slice(0, branch.base), ...branch.moves.slice(0, -1)],
    branch.base + branch.moves.length,
  )
  expect(branchParentFen(record, branch)).toBe(expected)
})

// --- isMainlineStep ---

test('isMainlineStep: true for the next mainline uci with no branch', () => {
  const record = makeRecord(['e2e4', 'e7e5'], [ply(1), ply(2)])
  expect(isMainlineStep(record, 0, null, 'e2e4')).toBe(true)
})

test('isMainlineStep: false when a branch is active', () => {
  const record = makeRecord(['e2e4', 'e7e5'], [ply(1), ply(2)])
  const branch: Branch = { base: 0, moves: [] }
  expect(isMainlineStep(record, 0, branch, 'e2e4')).toBe(false)
})

test('isMainlineStep: false for a different uci', () => {
  const record = makeRecord(['e2e4', 'e7e5'], [ply(1), ply(2)])
  expect(isMainlineStep(record, 0, null, 'd2d4')).toBe(false)
})

test('isMainlineStep: selected === null is treated as ply 0', () => {
  const record = makeRecord(['e2e4', 'e7e5'], [ply(1), ply(2)])
  expect(isMainlineStep(record, null, null, 'e2e4')).toBe(true)
})

// --- stepTo ---

test('stepTo clamps at the last ply', () => {
  expect(stepTo(5, 1, 5)).toBe(5)
})

test('stepTo clamps at the start: ArrowLeft from move 1 goes to null, null stays null', () => {
  expect(stepTo(1, -1, 5)).toBeNull()
  expect(stepTo(null, -1, 5)).toBeNull()
})

// --- estimatedElo ---

test('estimatedElo is monotonic in accuracy', () => {
  const low = estimatedElo(50)
  const mid = estimatedElo(75)
  const high = estimatedElo(99)
  expect(low).toBeLessThan(mid)
  expect(mid).toBeLessThan(high)
})
