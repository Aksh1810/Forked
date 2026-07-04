// Deterministic pseudo-random legal games for kill tests: same seed, same
// PGNs, so cache-behavior assertions are reproducible.
import { Chess } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { makeSanAndPlay } from 'chessops/san'
import { parseSquare, squareRank } from 'chessops/util'

function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function generateGames(count, { seed = 42, username = 'kill_tester', minPlies = 20 } = {}) {
  const pgns = []
  for (let g = 0; g < count; g++) {
    const rand = lcg(seed + g * 7919)
    const pos = Chess.default()
    const sans = []
    const target = minPlies + (g % 5) * 4
    for (let ply = 0; ply < target && !pos.isEnd(); ply++) {
      const dests = chessgroundDests(pos)
      const moves = []
      for (const [from, tos] of [...dests.entries()].sort()) {
        for (const to of [...tos].sort()) {
          const fromSq = parseSquare(from)
          const toSq = parseSquare(to)
          const piece = pos.board.get(fromSq)
          // skip promotions and castling-ambiguous king hops to keep moves simple
          if (piece?.role === 'pawn' && (squareRank(toSq) === 0 || squareRank(toSq) === 7)) continue
          moves.push({ from: fromSq, to: toSq })
        }
      }
      if (!moves.length) break
      const move = moves[Math.floor(rand() * moves.length)]
      sans.push(makeSanAndPlay(pos, move))
    }
    if (sans.length < 6) throw new Error(`generated game ${g} too short`)
    const white = g % 2 === 0 ? username : `opp${g}`
    const black = g % 2 === 0 ? `opp${g}` : username
    const movetext = sans
      .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
      .join(' ')
    pgns.push(
      `[Event "kill test game ${g}"]\n[Site "?"]\n[Date "2026.06.01"]\n[White "${white}"]\n[Black "${black}"]\n[Result "*"]\n[TimeControl "300"]\n\n${movetext} *\n`,
    )
  }
  return pgns
}
