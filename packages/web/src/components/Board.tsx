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
  // Retry mode (A2) and explore mode (Wave 2): click-only piece-then-destination
  // selection. v1 has no drag and no keyboard support — a plain onClick per
  // square is enough for the lite practice loop this powers.
  // ponytail: click-only v1, no drag/keyboard.
  onSquareClick?: (sq: string) => void
  selectedSq?: string
  // Legal-move dots for the currently selected piece (retry + explore modes).
  // Callers compute this via chessops `pos.dests(fromIdx)`.
  dests?: string[]
}) {
  let grid = ranks(fen)
  if (flip) grid = grid.slice().reverse().map((row) => row.slice().reverse())

  const gridEl = (
    <div
      role="img"
      aria-label={alt ?? 'chess position'}
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
              onClick={onSquareClick ? () => onSquareClick(square) : undefined}
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
    </div>
  )
}
