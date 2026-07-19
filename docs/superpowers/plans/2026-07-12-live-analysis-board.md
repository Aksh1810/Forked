# Always-Live Interactive Analysis Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mode-gated explore feature on the per-game review page with a chess.com-style always-live analysis board: one interactive board (click AND drag), browser Stockfish analyzing every shown position with three lines, and live classification badges on user-played moves.

**Architecture:** Evolve the existing bespoke components — `LiveEngine` gains MultiPV 3 and a `lines[]` update shape; the report page collapses explore-vs-mainline into `selected` + `branch`; `Board.tsx` gains pointer-event drag reusing the existing `clickMove` state machine; a new `EngineLines` panel renders the three lines; shared gains a per-move `classifyLive`. No new dependencies.

**Tech Stack:** Next.js (App Router, client component), chessops, stockfish 18 lite single-threaded wasm worker, vitest.

**Spec:** `docs/migration-plan.md`, section "Spec: always-live interactive analysis board (2026-07-12)".

## Global Constraints

- NO `git commit`, NO `git push` — the user does both (standing repo rule). Commit steps are replaced by verification steps.
- No new dependencies. No board library.
- All user-facing strings live in `packages/web/src/copy.ts`.
- Every deliberate simplification carries a `// ponytail:` comment naming the ceiling.
- Full check between tasks: `npx vitest run && npx tsc -b && npx eslint .` from repo root — all green before moving on.
- Existing behavior kept: retry mode, best-move preview, arrow-key stepping, Key filter, `?ply=` deep link, 112px coach-card slot (no layout shift), visibilitychange engine pause, `go movetime 8000`.

---

### Task 1: Engine — MultiPV 3, `lines[]` update shape

**Files:**
- Modify: `packages/web/src/lib/engine.ts`
- Modify: `packages/web/test/engine.test.ts`
- Modify: `packages/web/src/app/j/[jobId]/g/[gameId]/page.tsx` (mechanical `liveUpdate.*` accessor updates only, to keep tsc green — the real page rewrite is Task 5)

**Interfaces:**
- Produces: `interface EngineLine { eval: Eval; pvUci: string[] }`, `interface EngineUpdate { depth: number; lines: EngineLine[] }` (lines[0] = best, up to 3 entries), `parseInfoLine(line, blackToMove)` now returning `{ depth, multipv, eval, pvUci } | null`, `LiveEngine.analyze(fen, onUpdate)` unchanged signature.
- Consumes: nothing new.

- [ ] **Step 1: Update existing tests for the `multipv` field and add MultiPV tests**

In `packages/web/test/engine.test.ts`, every existing `toEqual` on the full parse result gains `multipv: 1`, e.g. the first test becomes:

```ts
test('parses a positive cp score, white to move', () => {
  const r = parseInfoLine('info depth 12 seldepth 18 score cp 34 nodes 123 pv e2e4 e7e5', false)
  expect(r).toEqual({ depth: 12, multipv: 1, eval: { type: 'cp', value: 34 }, pvUci: ['e2e4', 'e7e5'] })
})
```

Append new tests:

```ts
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
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npx vitest run packages/web/test/engine.test.ts`
Expected: FAIL — existing tests fail on missing `multipv` key; new tests fail the same way.

- [ ] **Step 3: Implement in `engine.ts`**

Change the update shape and parser:

```ts
export interface EngineLine {
  eval: Eval
  pvUci: string[]
}

export interface EngineUpdate {
  depth: number
  lines: EngineLine[] // lines[0] is the best line; up to 3 (MultiPV)
}
```

In `parseInfoLine`, after the existing `depthM`/`scoreM`/`pvM` extraction add:

```ts
const multipvM = /\bmultipv (\d+)/.exec(line)
```

and include `multipv: multipvM ? Number(multipvM[1]) : 1` in the returned object (return type: `{ depth: number; multipv: number; eval: Eval; pvUci: string[] } | null`).

In `LiveEngine`:

1. In `start()`'s handshake listener, on `uciok` send the option before `isready`:

```ts
if (e.data === 'uciok') {
  worker.postMessage('setoption name MultiPV value 3')
  worker.postMessage('isready')
}
```

2. Add a per-search line accumulator field:

```ts
// The three MultiPV slots for the current search; rebuilt from scratch on
// every analyze() so a new position never shows the old position's lines.
private lineSlots: (EngineLine & { depth: number })[] = []
```

3. In `handleLine`, after the existing parse+MIN_DEPTH gate, accumulate and emit only when line 1 exists:

```ts
const parsed = parseInfoLine(line, this.blackToMove)
if (!parsed || parsed.depth < MIN_DEPTH) return
this.lineSlots[parsed.multipv - 1] = { eval: parsed.eval, pvUci: parsed.pvUci, depth: parsed.depth }
const first = this.lineSlots[0]
if (!first) return // never emit an update without the best line
this.schedule({
  depth: first.depth,
  lines: this.lineSlots.filter(Boolean).map((l) => ({ eval: l.eval, pvUci: l.pvUci })),
})
```

4. In `analyze()`, alongside the existing resets add `this.lineSlots = []`.

Cache, throttle, stale-bestmove guard, stop/dispose, visibility handling: unchanged.

- [ ] **Step 4: Mechanically update the page's accessors so tsc stays green**

In `packages/web/src/app/j/[jobId]/g/[gameId]/page.tsx` (four spots, no behavior change):

- `shownEval = liveUpdate?.eval ?? …` → `liveUpdate?.lines[0]?.eval ?? …`
- `if (liveUpdate?.pvUci[0]) { const pv0 = liveUpdate.pvUci[0]; … }` → `if (liveUpdate?.lines[0]?.pvUci[0]) { const pv0 = liveUpdate.lines[0].pvUci[0]; … }`
- `sanMoves(liveUpdate.pvUci.slice(0, 4), …)` → `sanMoves(liveUpdate.lines[0]?.pvUci.slice(0, 4) ?? [], …)`
- In `ExploreCard`, `formatEval(liveUpdate.eval)` → `formatEval(liveUpdate.lines[0].eval)` and guard the render branch with `liveUpdate.lines[0] &&` (engine never emits without lines[0], guard is for the type).

- [ ] **Step 5: Verify green**

Run: `npx vitest run packages/web && npx tsc -b && npx eslint packages/web`
Expected: all pass.

---

### Task 2: Shared — per-move `classifyLive`

**Files:**
- Modify: `packages/shared/src/classify.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `packages/shared/test/classify.test.ts`

**Interfaces:**
- Produces: `classifyLive(before: Eval, after: Eval, mover: 'white' | 'black', playedBest: boolean): Enriched`
- Consumes: existing `moverWinPct` (win.js), `classifyWinPctSwing`, `mateAgainstMover` (file-local), `Enriched`.

- [ ] **Step 1: Write failing tests**

Append to `packages/shared/test/classify.test.ts`:

```ts
import { classifyLive } from '../src/classify.js'

// --- classifyLive ---

test('classifyLive: playedBest wins regardless of swing', () => {
  expect(classifyLive({ type: 'cp', value: 20 }, { type: 'cp', value: 10 }, 'white', true)).toBe('best')
})

test('classifyLive: tiny loss is excellent, small loss is good', () => {
  // white ~52 -> ~51: loss < 2
  expect(classifyLive({ type: 'cp', value: 15 }, { type: 'cp', value: 10 }, 'white', false)).toBe('excellent')
  // white ~57 -> ~50: loss ~7, between 2 and 10
  expect(classifyLive({ type: 'cp', value: 50 }, { type: 'cp', value: 0 }, 'white', false)).toBe('good')
})

test('classifyLive: loss bands map to inaccuracy/mistake', () => {
  // even -> clearly worse for the mover
  expect(classifyLive({ type: 'cp', value: 0 }, { type: 'cp', value: -90 }, 'white', false)).toBe('inaccuracy')
  expect(classifyLive({ type: 'cp', value: 0 }, { type: 'cp', value: -170 }, 'white', false)).toBe('mistake')
})

test('classifyLive: catastrophic blunder stays blunder (mate against mover)', () => {
  expect(classifyLive({ type: 'cp', value: 0 }, { type: 'mate', value: -3 }, 'white', false)).toBe('blunder')
})

test('classifyLive: non-catastrophic 30-40pt swing downgrades to mistake (blunder gate)', () => {
  // white 60 -> 28 win pct territory: loss >= 30 but < 40 and wpAfter > 15
  expect(classifyLive({ type: 'cp', value: 70 }, { type: 'cp', value: -160 }, 'white', false)).toBe('mistake')
})

test('classifyLive: black perspective (white-perspective evals negated for the mover)', () => {
  // black mover: cp -50 is GOOD for black; dropping to +50 is a loss for black
  expect(classifyLive({ type: 'cp', value: -50 }, { type: 'cp', value: 50 }, 'black', false)).toBe('good')
})
```

Note: the exact expected tiers above depend on `moverWinPct`'s curve — before finalizing, compute the actual win percentages for each pair with a scratch script and adjust cp inputs so each test lands squarely inside its intended band (loss <2, 2–10, 10–20, 20–30, 30–40 non-catastrophic, mate). Do not adjust the implementation to fit arbitrary inputs.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/shared/test/classify.test.ts`
Expected: FAIL — `classifyLive` is not exported.

- [ ] **Step 3: Implement**

In `packages/shared/src/classify.ts`, after `classifyWinPctSwing`:

```ts
// Live (browser-engine) per-move tier for user-played moves: the subset of
// enrichClassifications computable from ONE eval pair. No book detection, no
// sacrifice/great heuristics, no miss-relabel (those need mainline context).
// ponytail: 'brilliant'/'great'/'miss'/'book' unreachable here by design.
export function classifyLive(
  before: Eval,
  after: Eval,
  mover: 'white' | 'black',
  playedBest: boolean,
): Enriched {
  if (playedBest) return 'best'
  const wpBefore = moverWinPct(before, mover)
  const wpAfter = moverWinPct(after, mover)
  const loss = wpBefore - wpAfter
  const base = classifyWinPctSwing(wpBefore, wpAfter)
  // Same blunder gate as enrichClassifications: only catastrophic keeps it.
  if (base === 'blunder' && !mateAgainstMover(after, mover) && loss < 40 && wpAfter > 15) {
    return 'mistake'
  }
  if (base !== 'none') return base
  if (loss < 2) return 'excellent'
  if (loss < 10) return 'good'
  return 'none'
}
```

Export `classifyLive` from `packages/shared/src/index.ts` alongside the other classify exports.

- [ ] **Step 4: Verify green**

Run: `npx vitest run packages/shared && npx tsc -b`
Expected: all pass.

---

### Task 3: Board — drag-and-drop

**Files:**
- Modify: `packages/web/src/components/Board.tsx`
- Create: `packages/web/test/board.test.ts`
- Create: `packages/web/src/lib/moves.ts` (extracted `clickMove`/`destsFor`/`ClickResult` from page.tsx — Step 4)
- Create: `packages/web/test/moves.test.ts`
- Modify: `packages/web/src/app/j/[jobId]/g/[gameId]/page.tsx` (imports only)

**Interfaces:**
- Produces: `squareFromPoint(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, flip: boolean): string | null` (exported from Board.tsx for tests and for the drop handler). Board's public props are UNCHANGED — drag reuses the existing `onSquareClick` contract: pointerdown fires `onSquareClick(square)` (select), pointerup over a different square fires `onSquareClick(target)` (the page's `clickMove` machine completes or resets the move).
- Consumes: existing `squareAt(r, c, flip)` (file-local).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/board.test.ts`:

```ts
import { expect, test } from 'vitest'
import { squareFromPoint } from '../src/components/Board.js'

const rect = { left: 100, top: 100, width: 400, height: 400 } // 50px squares

test('maps a point to its square, white orientation', () => {
  // top-left square is a8; bottom-right is h1
  expect(squareFromPoint(rect, 101, 101, false)).toBe('a8')
  expect(squareFromPoint(rect, 499, 499, false)).toBe('h1')
  // e-file (col 4), rank 4 (row 4 from top): e4 center
  expect(squareFromPoint(rect, 100 + 4 * 50 + 25, 100 + 4 * 50 + 25, false)).toBe('e4')
})

test('maps a point to its square, flipped', () => {
  expect(squareFromPoint(rect, 101, 101, true)).toBe('h1')
  expect(squareFromPoint(rect, 499, 499, true)).toBe('a8')
})

test('returns null outside the board', () => {
  expect(squareFromPoint(rect, 99, 200, false)).toBeNull()
  expect(squareFromPoint(rect, 200, 501, false)).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/web/test/board.test.ts`
Expected: FAIL — `squareFromPoint` is not exported.

- [ ] **Step 3: Implement drag in Board.tsx**

Add the pure helper (exported, next to `squareAt`):

```ts
// Which square a viewport point lands on, given the board's bounding rect.
// Used by the pointerup drop handler; exported for tests.
export function squareFromPoint(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  flip: boolean,
): string | null {
  const c = Math.floor(((x - rect.left) / rect.width) * 8)
  const r = Math.floor(((y - rect.top) / rect.height) * 8)
  if (c < 0 || c > 7 || r < 0 || r > 7) return null
  return squareAt(r, c, flip)
}
```

Inside the `Board` component (only active when `onSquareClick` is provided):

```tsx
// Drag state: the square where the pointer went down (and its piece, for the
// ghost), plus the live pointer position. Click-to-move is unchanged — a
// pointerdown IS the click (select/deselect via the page's clickMove machine),
// and a pointerup over a different square completes the move.
const gridRef = useRef<HTMLDivElement>(null)
const [drag, setDrag] = useState<{ from: string; piece: string; x: number; y: number } | null>(null)
```

(add `import { useRef, useState } from 'react'` at the top — Board.tsx currently imports nothing from react.)

Replace each square's `onClick` with `onPointerDown`:

```tsx
onPointerDown={
  onSquareClick
    ? (e) => {
        e.preventDefault()
        onSquareClick(square)
        if (piece) setDrag({ from: square, piece, x: e.clientX, y: e.clientY })
      }
    : undefined
}
```

On the grid container add (only when `onSquareClick` is set):

```tsx
ref={gridRef}
onPointerMove={drag ? (e) => setDrag({ ...drag, x: e.clientX, y: e.clientY }) : undefined}
onPointerUp={
  onSquareClick && drag
    ? (e) => {
        const rect = gridRef.current?.getBoundingClientRect()
        setDrag(null)
        if (!rect) return
        const target = squareFromPoint(rect, e.clientX, e.clientY, flip)
        if (target && target !== drag.from) onSquareClick(target)
      }
    : undefined
}
onPointerCancel={() => setDrag(null)}
style={{ …existing grid styles…, touchAction: onSquareClick ? 'none' : undefined }}
```

Also call `e.currentTarget.setPointerCapture(e.pointerId)` in a grid-level `onPointerDown` (so `pointerup` outside the board still reaches us), and render the ghost piece when dragging AND the drag origin is the selected square (`selectedSq === drag.from` — a rejected selection shows no ghost):

```tsx
{drag && selectedSq === drag.from && (
  <div
    style={{
      position: 'fixed',
      left: drag.x,
      top: drag.y,
      transform: 'translate(-50%, -50%)',
      width: size / 8,
      height: size / 8,
      pointerEvents: 'none',
      opacity: 0.85,
      zIndex: 10,
    }}
  >
    <Piece piece={drag.piece} />
  </div>
)}
```

Behavior notes the implementer must preserve:
- pointerdown + pointerup on the SAME square = plain click-select (the up is a no-op) — deselect still works because a second pointerdown on the selected square routes through `clickMove`'s deselect branch.
- Squares keep `cursor: pointer`; remove the old `onClick` entirely (pointerdown replaces it — leaving both would double-fire and instantly deselect).
- `// ponytail:` note: no drag animation/snap, ghost only; promotion stays auto-queen.

- [ ] **Step 4: Extract and test the click/drag move state machine**

`clickMove` and `destsFor` currently live unexported in `page.tsx`. Move both, verbatim (including their comments and the `ClickResult` type), to a new `packages/web/src/lib/moves.ts`, export all three, and import them in `page.tsx`. Then create `packages/web/test/moves.test.ts`:

```ts
import { expect, test } from 'vitest'
import { clickMove, destsFor } from '../src/lib/moves.js'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

test('first click on own piece selects', () => {
  expect(clickMove(START, null, 'e2')).toEqual({ kind: 'select', from: 'e2' })
})

test('clicking the selected square deselects', () => {
  expect(clickMove(START, 'e2', 'e2')).toEqual({ kind: 'deselect' })
})

test('legal destination plays the move', () => {
  expect(clickMove(START, 'e2', 'e4')).toEqual({ kind: 'move', uci: 'e2e4' })
})

test('illegal destination resets', () => {
  expect(clickMove(START, 'e2', 'e5')).toEqual({ kind: 'reset' })
})

test('clicking another own piece re-selects', () => {
  expect(clickMove(START, 'e2', 'g1')).toEqual({ kind: 'select', from: 'g1' })
})

test('opponent piece with nothing selected resets', () => {
  expect(clickMove(START, null, 'e7')).toEqual({ kind: 'reset' })
})

test('promotion auto-queens', () => {
  const fen = '8/4P3/8/8/8/8/8/K1k5 w - - 0 1'
  expect(clickMove(fen, 'e7', 'e8')).toEqual({ kind: 'move', uci: 'e7e8q' })
})

test('destsFor lists legal destinations', () => {
  expect(destsFor(START, 'e2')?.sort()).toEqual(['e3', 'e4'])
  expect(destsFor(START, null)).toBeUndefined()
})
```

Run: `npx vitest run packages/web/test/moves.test.ts` — expected FAIL before the move (module missing), PASS after.

- [ ] **Step 5: Verify green + hand-check drag**

Run: `npx vitest run packages/web && npx tsc -b && npx eslint packages/web`
Expected: all pass. (Interactive drag verification happens in Task 7 against the dev server.)

---

### Task 4: `EngineLines` panel component

**Files:**
- Create: `packages/web/src/components/EngineLines.tsx`
- Modify: `packages/web/src/copy.ts`
- Modify: `packages/web/src/app/globals.css`

**Interfaces:**
- Produces: `EngineLines({ status, update, prefixUci, onPlayMove }: { status: 'off' | 'loading' | 'ready' | 'failed'; update: EngineUpdate | null; prefixUci: string[]; onPlayMove: (uci: string) => void })` — three fixed-height rows; each row click calls `onPlayMove(line.pvUci[0])`.
- Consumes: `EngineUpdate`/`EngineLine` (Task 1), `formatEval` from `components/EvalBar`, `sanMoves` from `@forked/shared`.

- [ ] **Step 1: Add copy strings**

In `packages/web/src/copy.ts` next to the explore strings:

```ts
engineLinesLoading: 'Loading engine…',
engineLinesUnavailable: 'Engine unavailable — stored analysis still shown.',
engineDepth: (d: number) => `depth ${d}`,
```

- [ ] **Step 2: Implement the component**

Create `packages/web/src/components/EngineLines.tsx`:

```tsx
import { sanMoves } from '@forked/shared'
import type { EngineUpdate } from '../lib/engine'
import { formatEval } from './EvalBar'
import { copy } from '../copy'

// The chess.com-style live engine panel: up to three MultiPV lines, each a
// clickable row (eval chip + SAN preview) that plays the line's first move.
// Fixed height (.engine-lines in globals.css) so the panel below never
// shifts as lines stream in.
export function EngineLines({
  status,
  update,
  prefixUci,
  onPlayMove,
}: {
  status: 'off' | 'loading' | 'ready' | 'failed'
  update: EngineUpdate | null
  prefixUci: string[]
  onPlayMove: (uci: string) => void
}) {
  return (
    <div className="engine-lines">
      {status === 'failed' && <p className="quiet">{copy.coach.engineLinesUnavailable}</p>}
      {(status === 'loading' || (status === 'ready' && !update)) && (
        <p className="quiet">{copy.coach.engineLinesLoading}</p>
      )}
      {status === 'ready' && update && (
        <>
          <p className="quiet mono engine-lines-depth">{copy.coach.engineDepth(update.depth)}</p>
          {update.lines.map((l, i) => (
            <button key={i} className="engine-line mono" onClick={() => onPlayMove(l.pvUci[0])}>
              <span className="engine-line-eval">{formatEval(l.eval)}</span>
              <span className="engine-line-sans">{sanMoves(l.pvUci.slice(0, 6), prefixUci).join(' ')}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Style it**

In `globals.css`, near `.coach-card`:

```css
/* Live engine lines panel: fixed slot (depth line + 3 rows) so streaming
   updates never shift the move list below. */
.engine-lines {
  height: 108px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.engine-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
  text-align: left;
  background: none;
  border: none;
  padding: 2px 4px;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.engine-line-eval {
  font-weight: 700;
  min-width: 44px;
}
.engine-line-sans {
  overflow: hidden;
  text-overflow: ellipsis;
}
.engine-lines-depth {
  font-size: 0.75rem;
  margin: 0;
}
@media (hover: hover) {
  .engine-line:hover {
    background: color-mix(in srgb, var(--bone) 6%, transparent);
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc -b && npx eslint packages/web`
Expected: pass. (The component is unused until Task 5 wires it in — `eslint` must not flag it; if unused-export rules complain, wire-in order is Task 5's problem, suppress nothing.)

---

### Task 5: Report page — unified always-live board

**Files:**
- Modify: `packages/web/src/app/j/[jobId]/g/[gameId]/page.tsx`
- Modify: `packages/web/src/copy.ts`

**Interfaces:**
- Consumes: `EngineUpdate.lines` (Task 1), `EngineLines` (Task 4), existing `clickMove`/`destsFor`/`stepTo`.
- Produces: page state `branch: { base: number; moves: string[] } | null` (renamed from `explore`), always-on engine, `playUserMove(uci: string)` used by both the board click/drag handler and `EngineLines.onPlayMove`.

This task is a refactor of existing behavior plus lifecycle changes; the page has no unit tests (it's exercised live in Task 7). Sub-steps:

- [ ] **Step 1: Rename `explore` → `branch` throughout the page**

Mechanical rename: `explore`/`setExplore` → `branch`/`setBranch`, `exploreFen` → `branchFen`, `exploreSel` → `boardSel`, `ExploreCard` → `BranchCard`, `undoExplore` → `undoBranch`, `exploreSans` → `branchSans`, `explorePrefix` → `branchPrefix`. Copy keys stay (`copy.coach.explore*` renamed keys optional — if renamed, rename in copy.ts too, exhaustively).

- [ ] **Step 2: Engine always on**

Replace the lazy `[exploreFen]` engine effect with an effect keyed on the SHOWN fen:

```ts
// The position the board is showing (mainline, branch, preview, or retry).
// The engine analyzes it whenever engine output is visible — always, except
// while retry-guessing (live lines would reveal the answer).
const shownFen = fen // computed below as today; move the fen derivation ABOVE this effect or mirror it in a useMemo
```

Concretely: lift the existing `fen` derivation (the `explore/retryGuessing/showBestLine` if-chain) into a `useMemo` placed before the early returns, guarded on `record` (return `null` when no record), so the engine effect can depend on it:

```ts
const shownFen = useMemo(() => {
  if (!record) return null
  if (branch && branchFen) return branchFen
  if (retry && retry.outcome !== 'success') return null // engine paused while guessing
  if ((preview || retry?.outcome === 'success') && selected !== null) {
    const p = record.plies.find((q) => q.ply === selected)
    if (p) return fenBeforePly([...record.uciMoves.slice(0, selected - 1), p.best], selected + 1)
  }
  return fenBeforePly(record.uciMoves, (selected ?? 0) + 1)
}, [record, branch, branchFen, retry, preview, selected])
```

The render-time `fen` if-chain then reads: `retryGuessing` → `fenBeforePly(record.uciMoves, selected ?? 0)` (unchanged), else `shownFen!`.

Engine effect: same body as today but keyed on `[shownFen]`, and engine START moves to record-load time:

```ts
// Start the engine as soon as the record lands (always-on live analysis).
useEffect(() => {
  if (!record || engineRef.current) return
  engineRef.current = new LiveEngine()
  setEngineStatus('loading')
  engineStartRef.current = engineRef.current.start()
  engineStartRef.current.then(() => setEngineStatus('ready'), () => setEngineStatus('failed'))
}, [record])
```

The `[shownFen]` effect drops the creation branch and just awaits `engineStartRef.current`, then `analyze(shownFen, …)`; on `shownFen === null` it calls `engineRef.current?.stop()` and clears `liveUpdate` (existing pattern).

- [ ] **Step 3: One move handler for board + lines panel**

Replace `onExploreSquareClick`'s move branch with a shared function:

```ts
// Plays a user move on the shown position: steps forward when it IS the
// next mainline move (chess.com behavior), otherwise starts/extends the
// single active branch.
function playUserMove(uci: string) {
  setBoardSel(null)
  setLiveUpdate(null)
  const nextMainline = record.uciMoves[branch ? -1 : (selected ?? 0)]
  if (!branch && uci === nextMainline) {
    setSelected((selected ?? 0) + 1)
    return
  }
  setBranch((b) => (b ? { base: b.base, moves: [...b.moves, uci] } : { base: selected ?? 0, moves: [uci] }))
}
```

`onBoardSquareClick(sq)` (the renamed `onExploreSquareClick`) routes its `move` result through `playUserMove(r.uci)`. `EngineLines` gets `onPlayMove={playUserMove}`.

- [ ] **Step 4: Wire in `EngineLines`, hide engine output while retry-guessing**

In the review panel, render the panel between the coach-card slot and the button row:

```tsx
{!retryGuessing && (
  <EngineLines
    status={engineStatus}
    update={liveUpdate}
    prefixUci={branch ? [...branchPrefix, ...branch.moves] : record.uciMoves.slice(0, selected ?? 0)}
    onPlayMove={playUserMove}
  />
)}
```

(While guessing, the slot collapses — acceptable shift since retry is an explicit user action; alternatively render `<div className="engine-lines" />` empty to hold height. Hold the height — empty div.)

- [ ] **Step 5: Eval bar and arrows from live lines[0]**

- Eval bar: `shownEval` — when NOT retry-guessing and `liveUpdate` exists: `liveUpdate.lines[0].eval`. Else the existing stored-eval walk (which stays as the instant value before live output lands, and permanently on engine failure). Delete the branch-only special case.
- Arrows: mainline selected-ply arrows UNCHANGED (stored `ply.best`). Branch positions: arrow from `liveUpdate.lines[0].pvUci[0]` (existing explore behavior, renamed). Do NOT add live arrows on mainline plies — the stored arrow already is the engine's best and never flickers.
- Best-preview and retry rendering paths: unchanged.

- [ ] **Step 6: Branch discard semantics + keyboard**

Unchanged from explore (stepping/selecting discards the branch — the existing `[selected]` effect and `select()` already do this after the rename). Keyboard: ArrowLeft while a branch is active = `undoBranch()` (existing). Remove nothing else.

- [ ] **Step 7: Verify green**

Run: `npx vitest run && npx tsc -b && npx eslint .`
Expected: all pass.

---

### Task 6: Live classification badges on user moves

**Files:**
- Modify: `packages/web/src/app/j/[jobId]/g/[gameId]/page.tsx`

**Interfaces:**
- Consumes: `classifyLive` (Task 2), `liveUpdate.lines[0]` (Task 1), `branch` state (Task 5).
- Produces: `branchBadge: { square: string; kind: Enriched } | null` page state, rendered through Board's existing `badge` prop.

- [ ] **Step 1: Capture the eval pair around a user move**

Page state + a ref for the pending judgment:

```ts
const [branchBadge, setBranchBadge] = useState<{ square: string; kind: Enriched } | null>(null)
// The pending live judgment for the LAST user move: eval + best move of the
// parent position, captured at play time. Judged once the child position's
// live eval reaches depth >= 12.
const pendingJudgeRef = useRef<{ before: Eval; bestUci: string | null; uci: string } | null>(null)
```

In `playUserMove`, before the state updates:

```ts
pendingJudgeRef.current = {
  before: liveUpdate?.lines[0]?.eval ?? shownEvalForJudge, // live parent eval if present, else the stored/derived eval currently on the bar
  bestUci: liveUpdate?.lines[0]?.pvUci[0] ?? null,
  uci,
}
setBranchBadge(null)
```

(`shownEvalForJudge` = the same value the eval bar is currently showing — extract the bar's eval computation into a variable both can read.)

`undoBranch`, branch exit, and `select()` clear both `pendingJudgeRef.current` and `branchBadge`.

- [ ] **Step 2: Judge on depth ≥ 12**

Effect on `liveUpdate`:

```ts
// ponytail: judges only the latest move (no per-move history), depth 12
// threshold hardcoded — chess.com-style refine delay, tune if it feels slow.
useEffect(() => {
  const pending = pendingJudgeRef.current
  if (!pending || !branch || !liveUpdate || liveUpdate.depth < 12) return
  const mover = (branch.base + branch.moves.length) % 2 === 1 ? 'white' : 'black'
  const kind = classifyLive(pending.before, liveUpdate.lines[0].eval, mover, pending.uci === pending.bestUci)
  pendingJudgeRef.current = null
  if (kind !== 'none') setBranchBadge({ square: pending.uci.slice(2, 4), kind })
}, [liveUpdate, branch])
```

(mover parity: ply number of the user move is `branch.base + branch.moves.length`; odd = white.)

- [ ] **Step 3: Render the badge**

In the branch arm of the badge/lastMove/tint derivation (Task 5's renamed explore arm): `badge = branchBadge ?? undefined`, and tint the last-move highlight by tier when a badge exists: `tint = branchBadge ? \`${TIER[branchBadge.kind].color}66\` : undefined` (undefined keeps the neutral yellow glow until judged).

- [ ] **Step 4: Verify green**

Run: `npx vitest run && npx tsc -b && npx eslint .`
Expected: all pass.

---

### Task 7: Live verification sweep

**Files:**
- Create: nothing checked in — use the scratchpad for any probe scripts.

- [ ] **Step 1: Full static check**

Run: `npx vitest run && npx tsc -b && npx eslint .`
Expected: all green (record the test count).

- [ ] **Step 2: Live checks against the dev server** (user's dev server on :3000; use the Chrome extension for input verification — headless CDP input simulation is known-unreliable in this repo)

Checklist, on a real analyzed game:

1. Open a report → lines panel shows "Loading engine…" then 3 lines with evals + depth, streaming deeper. Eval bar shows stored eval instantly, then live.
2. Step through mainline plies → engine re-analyzes each; panel updates; stored arrows/badges unchanged; no layout shift (toolbar y constant across plies).
3. Click-move a piece → branch starts, variation row in move list, live eval + arrow.
4. Drag-move a piece (desktop + 390px mobile emulation) → same result; ghost follows pointer; drop outside board = selection kept, no move.
5. Play the actual next mainline move from a mainline position → steps forward, NO branch.
6. Click an engine line row → its first move plays onto the board.
7. After a deliberately bad branch move, badge appears within ~1–2s (depth 12) with a sensible tier; best reply move shows a `best` badge.
8. Retry mode: enter on a blunder ply → lines panel slot holds height but shows nothing, no arrows, eval bar shows the before-eval (no leak). Solve/reveal both still work.
9. Best preview: unchanged behavior; engine analyzes the preview position (panel updates).
10. Undo (chip + ArrowLeft) pops branch moves; emptying exits; badge clears.
11. Engine failure path: temporarily rename `/engine/` worker script in a scratch build or block it via devtools → page fully works on stored evals, quiet unavailable line.

- [ ] **Step 3: Report**

Summarize results + test counts. NO commit — user commits.
