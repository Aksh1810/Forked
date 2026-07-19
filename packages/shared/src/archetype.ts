import { moveAccuracyPct, gameAccuracies } from './accuracy.js'
import { openingFamily } from './aggregates.js'
import { finalStatus } from './pgn.js'
import { userMoves, type AnalyzedGame } from './insights.js'

// The computed features an archetype is decided from. Kept separate from the
// decision so the decision is a pure, exhaustively table-testable function.
export interface ArchetypeFeatures {
  games: number
  timePressureDropPct: number | null
  maxFamilyShare: number
  overallBlunderRate: number
  losingBlunderRate: number | null
  losingMoves: number
  medianPlies: number
  bookDepthAvg: number
  postBookAccuracyDropPct: number | null
  winningConversion: number | null
  winningReached: number
  accuracyStdev: number | null
}

export interface Archetype {
  key: string
  name: string
  description: string
  mark: string
}

// Exactly one archetype per job, first matching rule in order. Ordered, pure,
// deterministic; the thresholds are the spec's. The final rule always matches,
// so this never returns null.
export function archetype(f: ArchetypeFeatures): Archetype {
  if (f.timePressureDropPct !== null && f.timePressureDropPct >= 25) {
    return {
      key: 'flagged',
      name: 'The Flagged',
      description: 'Your clock kills you before your opponent does.',
      mark: '??',
    }
  }
  if (f.maxFamilyShare >= 0.4) {
    return {
      key: 'one-trick-knight',
      name: 'One Trick Knight',
      description: 'You have a repertoire of exactly one idea.',
      mark: '?!',
    }
  }
  if (f.losingBlunderRate !== null && f.losingMoves >= 10 && f.losingBlunderRate >= 2 * f.overallBlunderRate && f.overallBlunderRate > 0) {
    return {
      key: 'hope-chess',
      name: 'Hope Chess Enjoyer',
      description: 'Down a piece, up a dream.',
      mark: '?',
    }
  }
  if (f.medianPlies >= 110) {
    return {
      key: 'grinder',
      name: 'The Grinder',
      description: "You don't win. You outlast.",
      mark: '!',
    }
  }
  if (f.bookDepthAvg >= 10 && f.postBookAccuracyDropPct !== null && f.postBookAccuracyDropPct >= 15) {
    return {
      key: 'theory-sprinter',
      name: 'Theory Sprinter',
      description: 'Prepared until move 12. Then, improvisation.',
      mark: 'book',
    }
  }
  if (f.winningConversion !== null && f.winningReached >= 5 && f.winningConversion >= 0.85) {
    return {
      key: 'converter',
      name: 'The Converter',
      description: "When you're up, it's over.",
      mark: '!',
    }
  }
  if (f.accuracyStdev !== null && f.accuracyStdev >= 18) {
    return {
      key: 'chaos-merchant',
      name: 'Chaos Merchant',
      description: 'Your engine correlation is a coin flip.',
      mark: '?!',
    }
  }
  return {
    key: 'solid-one',
    name: 'The Solid One',
    description: 'Boring. Effective. Boring.',
    mark: '!',
  }
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const stdev = (xs: number[]): number | null => {
  if (xs.length < 2) return null
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

// Derives the archetype features from the joined games. Uses the same
// per-move walk every other insight uses, so the numbers are consistent.
export function computeArchetypeFeatures(
  games: readonly AnalyzedGame[],
  timePressureDropPct: number | null,
): ArchetypeFeatures {
  const userGames = games.filter((g) => g.userColor)
  const allMoves = userGames.flatMap(userMoves)

  const famCounts = new Map<string, number>()
  for (const g of userGames) {
    const fam = openingFamily(g.game.eco, g.game.openingName)
    famCounts.set(fam, (famCounts.get(fam) ?? 0) + 1)
  }
  const maxFamilyShare = userGames.length ? Math.max(0, ...famCounts.values()) / userGames.length : 0

  const blunders = allMoves.filter((m) => m.classification === 'blunder').length
  const overallBlunderRate = allMoves.length ? blunders / allMoves.length : 0
  const losing = allMoves.filter((m) => m.wpBefore < 40)
  const losingBlunderRate = losing.length
    ? losing.filter((m) => m.classification === 'blunder').length / losing.length
    : null

  const medianPlies = median(userGames.map((g) => g.record.plies.length))

  const bookDepths = userGames.map((g) => g.record.plies.filter((p) => p.book).length)
  const bookDepthAvg = bookDepths.length ? bookDepths.reduce((a, b) => a + b, 0) / bookDepths.length : 0

  // Post-book accuracy: the user's non-book moves in the first six plies after
  // book, versus their overall accuracy. A large drop is the sprinter tell.
  const postBookLosses: number[] = []
  for (const g of userGames) {
    const book = g.record.plies.filter((p) => p.book).length
    for (const m of userMoves(g)) {
      if (m.ply > book && m.ply <= book + 6) postBookLosses.push(m.lossPct)
    }
  }
  // Per-move accuracy, then mean — not the curve applied to the average loss
  // (see accuracy.ts). Both inputs already exclude book plies.
  const overallAcc = allMoves.length
    ? allMoves.reduce((s, m) => s + moveAccuracyPct(m.lossPct), 0) / allMoves.length
    : null
  const postBookAcc = postBookLosses.length
    ? postBookLosses.reduce((s, l) => s + moveAccuracyPct(l), 0) / postBookLosses.length
    : null
  const postBookAccuracyDropPct =
    overallAcc !== null && postBookAcc !== null ? overallAcc - postBookAcc : null

  // Winning conversion: of games where the user reached a winning position,
  // how many they went on to win.
  let winningReached = 0
  let winningWon = 0
  for (const g of userGames) {
    const ms = userMoves(g)
    const reached = ms.some((m) => m.wpBefore > 80 || m.wpAfter > 80)
    if (reached) {
      winningReached += 1
      if (ms[0]?.won) winningWon += 1
    }
  }
  const winningConversion = winningReached ? winningWon / winningReached : null

  const perGameAcc = userGames.flatMap((g) => {
    const a = gameAccuracies(g.record, finalStatus(g.record.uciMoves))[g.userColor as 'white' | 'black']
    return a === null ? [] : [a]
  })

  return {
    games: userGames.length,
    timePressureDropPct,
    maxFamilyShare,
    overallBlunderRate,
    losingBlunderRate,
    losingMoves: losing.length,
    medianPlies,
    bookDepthAvg,
    postBookAccuracyDropPct,
    winningConversion,
    winningReached,
    accuracyStdev: stdev(perGameAcc),
  }
}
