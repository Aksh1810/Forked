'use client'

import { useRef, useState } from 'react'
import type { Enriched } from '@forked/shared'
import { Piece } from './pieces'
import { TIER } from './classification'

// A static board from a FEN, rendered as an 8x8 grid with the cburnett piece
// set. No board library: it is one grid and a piece lookup. Always has alt
// text; never hover-only.

function ranks(fen: string): string[][] {
  const board = fen.split(' ')[0]
  return board.split('/').map((row) => {
    const cells: string[] = []
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push('')
      else cells.push(ch)
    }
    return cells
  })
}

// Square center in 0-8 svg units, matching how `ranks()` lays rows out
// top-to-bottom (rank8 first) and, when flipped, how the grid below reverses
// both rows and each row's cells.
function squareCenter(square: string, flip: boolean): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97 // a=0 .. h=7
  const rank = Number(square[1]) - 1 // 1=0 .. 8=7
  return flip ? { x: 7.5 - file, y: rank + 0.5 } : { x: file + 0.5, y: 7.5 - rank }
}

// Inverse of squareCenter: which square sits at visual grid position (r, c)
// (r/c are post-flip indices, i.e. what the render loop below iterates).
function squareAt(r: number, c: number, flip: boolean): string {
  const file = flip ? 7 - c : c
  const rank = flip ? r + 1 : 8 - r
  return `${String.fromCharCode(97 + file)}${rank}`
}

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

// Pure decision for one pointerdown->pointerup gesture on the board.
// `downSelected` is whether the square the pointer went down on was ALREADY
// selectedSq at that moment (i.e. pointerdown was a no-op — it did not fire
// onSquareClick — so a plain click there must deselect on pointerup, and a
// drag from there must complete as a move). When pointerdown was NOT already
// selected, pointerdown fires onSquareClick itself (select or immediate
// move), so a same-square pointerup must fire nothing or it would double the
// gesture. Exported for tests (board.test.ts).
export function dropAction({
  downSquare,
  downSelected,
  upSquare,
}: {
  downSquare: string
  downSelected: boolean
  upSquare: string | null
}): 'none' | 'move' | 'deselect' {
  if (upSquare === null) return 'none'
  if (upSquare !== downSquare) return 'move'
  return downSelected ? 'deselect' : 'none'
}

// Thick, translucent, rounded suggestion arrow (chess.com style): a wide
// stroke and a proportionally bigger head read clearly at any board size.
function Arrow({ from, to, color, flip }: { from: string; to: string; color: string; flip: boolean }) {
  const p1 = squareCenter(from, flip)
  const p2 = squareCenter(to, flip)
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
  const headLen = 0.38
  const backX = p2.x - headLen * Math.cos(angle)
  const backY = p2.y - headLen * Math.sin(angle)
  const spread = 0.24
  const leftX = backX + spread * Math.cos(angle + Math.PI / 2)
  const leftY = backY + spread * Math.sin(angle + Math.PI / 2)
  const rightX = backX + spread * Math.cos(angle - Math.PI / 2)
  const rightY = backY + spread * Math.sin(angle - Math.PI / 2)
  return (
    <g opacity={0.75}>
      <line x1={p1.x} y1={p1.y} x2={backX} y2={backY} stroke={color} strokeWidth={0.22} strokeLinecap="round" />
      <polygon points={`${p2.x},${p2.y} ${leftX},${leftY} ${rightX},${rightY}`} fill={color} />
    </g>
  )
}

export function Board({
  fen,
  size = 240,
  alt,
  flip = false,
  arrows,
  coords = false,
  lastMove,
  tint,
  badge,
  onSquareClick,
  selectedSq,
  dests,
}: {
  fen: string
  size?: number
  alt?: string
  flip?: boolean
  arrows?: { from: string; to: string; color: string }[]
  coords?: boolean
  lastMove?: { from: string; to: string }
  // Last-move highlight color; defaults to the original yellow glow. Callers
  // tint this by classification (orange for a mistake, green for best, ...).
  tint?: string
  badge?: { square: string; kind: Enriched }
  // Retry mode (A2) and explore mode (Wave 2): click-and-drag piece-then
  // -destination selection. No keyboard support yet.
  onSquareClick?: (sq: string) => void
  selectedSq?: string
  // Legal-move dots for the currently selected piece (retry + explore modes).
  // Callers compute this via chessops `pos.dests(fromIdx)`.
  dests?: string[]
}) {
  // Drag state: the square where the pointer went down (and its piece, for
  // the ghost), the live pointer position, and whether that square was
  // already selected at pointerdown (see dropAction above — this is what
  // lets click-to-select-then-drag-the-same-piece work instead of silently
  // deselecting before the drag starts).
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ from: string; piece: string; x: number; y: number; downSelected: boolean } | null>(
    null,
  )

  let grid = ranks(fen)
  if (flip) grid = grid.slice().reverse().map((row) => row.slice().reverse())

  const gridEl = (
    <div
      role="img"
      aria-label={alt ?? 'chess position'}
      ref={gridRef}
      onPointerDown={
        onSquareClick
          ? (e) => {
              if (e.button !== 0) return // FIX 6: ignore right/middle-click
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          : undefined
      }
      onPointerMove={drag ? (e) => setDrag({ ...drag, x: e.clientX, y: e.clientY }) : undefined}
      onPointerUp={
        onSquareClick && drag
          ? (e) => {
              const rect = gridRef.current?.getBoundingClientRect()
              const target = rect ? squareFromPoint(rect, e.clientX, e.clientY, flip) : null
              const action = dropAction({ downSquare: drag.from, downSelected: drag.downSelected, upSquare: target })
              setDrag(null)
              if (action === 'move' && target) onSquareClick(target)
              else if (action === 'deselect') onSquareClick(drag.from)
            }
          : undefined
      }
      onPointerCancel={() => setDrag(null)}
      style={{
        display: 'grid',
        // minmax(0, 1fr) on both axes: plain 1fr has an implicit auto MINIMUM,
        // so ranks holding pieces demand the piece svg's min-content height and
        // end up taller than empty ranks (and can burst the aspect ratio once
        // every rank is occupied). A zero minimum splits the board evenly.
        gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
        width: size,
        maxWidth: '100%',
        aspectRatio: '1 / 1',
        border: '1px solid var(--line)',
        // I3: 'none' only while an actual drag is in flight — a clickable
        // board otherwise allows vertical page scroll (pan-y). `drag` is set
        // on pointerdown and cleared on pointerup/cancel, so this already
        // tracks the in-progress-drag window without extra imperative DOM
        // writes.
        touchAction: drag ? 'none' : onSquareClick ? 'pan-y' : undefined,
      }}
    >
      {grid.flatMap((row, r) =>
        row.map((piece, c) => {
          const dark = (r + c) % 2 === 1
          const square = squareAt(r, c, flip)
          const tinted = lastMove && (square === lastMove.from || square === lastMove.to)
          const b = badge && badge.square === square && badge.kind !== 'none' ? TIER[badge.kind] : null
          return (
            <div
              key={`${r}-${c}`}
              onPointerDown={
                onSquareClick
                  ? (e) => {
                      if (e.button !== 0) return // FIX 6: ignore right/middle-click
                      e.preventDefault()
                      // FIX 1: a square that's already selected does NOT fire a
                      // second click on pointerdown — that would deselect it
                      // before the drag even starts. It only fires (deselect
                      // or move) on pointerup, via dropAction below.
                      const downSelected = selectedSq === square
                      if (!downSelected) onSquareClick(square)
                      if (piece) setDrag({ from: square, piece, x: e.clientX, y: e.clientY, downSelected })
                    }
                  : undefined
              }
              style={{
                position: 'relative',
                display: 'grid',
                placeItems: 'center',
                background: dark ? 'var(--sq-dark)' : 'var(--sq-light)',
                cursor: onSquareClick ? 'pointer' : undefined,
              }}
            >
              {tinted && (
                <div style={{ position: 'absolute', inset: 0, background: tint ?? 'rgba(255,213,79,.45)' }} />
              )}
              {selectedSq === square && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    boxShadow: 'inset 0 0 0 3px rgba(255,255,255,.85)',
                  }}
                />
              )}
              {dests?.includes(square) && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '28%',
                    height: '28%',
                    borderRadius: '50%',
                    background: dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.25)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {piece && (
                <div style={{ position: 'relative', width: '92%', height: '92%' }}>
                  <Piece piece={piece} />
                </div>
              )}
              {coords && r === 7 && (
                <span
                  className="mono"
                  style={{
                    position: 'absolute',
                    right: 2,
                    bottom: 1,
                    fontSize: 10,
                    fontWeight: 600,
                    color: dark ? 'var(--sq-light)' : 'var(--sq-dark)',
                    lineHeight: 1,
                  }}
                >
                  {square[0]}
                </span>
              )}
              {coords && c === 0 && (
                <span
                  className="mono"
                  style={{
                    position: 'absolute',
                    left: 2,
                    top: 1,
                    fontSize: 10,
                    fontWeight: 600,
                    color: dark ? 'var(--sq-light)' : 'var(--sq-dark)',
                    lineHeight: 1,
                  }}
                >
                  {square[1]}
                </span>
              )}
              {b && (
                <div
                  className={badge?.kind === 'brilliant' || badge?.kind === 'great' ? 'badge-pop' : undefined}
                  style={{
                    position: 'absolute',
                    top: '-8%',
                    right: '-8%',
                    width: '32%',
                    height: '32%',
                    zIndex: 2,
                    borderRadius: '50%',
                    background: b.color,
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '50%',
                    fontWeight: 700,
                    lineHeight: 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,.5)',
                  }}
                >
                  {b.glyph}
                </div>
              )}
            </div>
          )
        }),
      )}
    </div>
  )

  // FIX 5: the board is rendered at maxWidth: 100%, so `size` can be larger
  // than the actual on-screen square — read the real rect once a drag exists.
  const ghostSize = drag ? (gridRef.current?.getBoundingClientRect().width ?? size) / 8 : 0

  return (
    <div style={{ position: 'relative', width: size, maxWidth: '100%' }}>
      {gridEl}
      {arrows && arrows.length > 0 && (
        <svg viewBox="0 0 8 8" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {arrows.map((a, i) => (
            <Arrow key={i} from={a.from} to={a.to} color={a.color} flip={flip} />
          ))}
        </svg>
      )}
      {/* ponytail: no drag animation/snap, ghost only; promotion stays auto-queen. */}
      {drag && selectedSq === drag.from && (
        <div
          style={{
            position: 'fixed',
            left: drag.x,
            top: drag.y,
            transform: 'translate(-50%, -50%)',
            // FIX 5: size from the board's ACTUAL rendered square (it's
            // maxWidth: 100%, so `size` overstates it on narrow viewports).
            width: ghostSize,
            height: ghostSize,
            pointerEvents: 'none',
            opacity: 0.85,
            zIndex: 10,
          }}
        >
          <Piece piece={drag.piece} />
        </div>
      )}
    </div>
  )
}
