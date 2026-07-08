// A static board from a FEN, rendered as an 8x8 grid with the classic
// public-domain Unicode chess glyphs. No board library: it is one grid and a
// character map. Always has alt text; never hover-only.
const GLYPHS: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

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

export function Board({ fen, size = 240, alt }: { fen: string; size?: number; alt?: string }) {
  const grid = ranks(fen)
  return (
    <div
      role="img"
      aria-label={alt ?? 'chess position'}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        width: size,
        height: size,
        maxWidth: '100%',
        aspectRatio: '1 / 1',
        border: '1px solid var(--line)',
      }}
    >
      {grid.flatMap((row, r) =>
        row.map((piece, c) => {
          const dark = (r + c) % 2 === 1
          return (
            <div
              key={`${r}-${c}`}
              style={{
                display: 'grid',
                placeItems: 'center',
                background: dark ? '#20232B' : '#2C303A',
                color: piece && piece === piece.toLowerCase() ? '#0B0C10' : '#E8E4D9',
                fontSize: size / 10,
                lineHeight: 1,
              }}
            >
              {piece ? (GLYPHS[piece] ?? '') : ''}
            </div>
          )
        }),
      )}
    </div>
  )
}
