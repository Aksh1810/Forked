import { moveAccuracyPct } from './accuracy.js'
import { outcomeFor } from './player.js'
import { userMoves, fenBeforePly, walkGame, type AnalyzedGame, type UserMove } from './walk.js'

export type { AnalyzedGame, UserMove } from './walk.js'
export { userMoves, fenBeforePly } from './walk.js'

const TIME_BUCKETS = [
  { label: '<10s', lo: 0, hi: 10 },
  { label: '10-30s', lo: 10, hi: 30 },
  { label: '30-60s', lo: 30, hi: 60 },
  { label: '60s+', lo: 60, hi: Infinity },
] as const

interface RateRow {
  key: string
  moves: number
  blunders: number
  rate: number
}

function ratesBy<T extends string>(
  moves: readonly UserMove[],
  keyOf: (m: UserMove) => T,
): Map<T, RateRow> {
  const acc = new Map<T, RateRow>()
  for (const m of moves) {
    const k = keyOf(m)
    const row = acc.get(k) ?? { key: k, moves: 0, blunders: 0, rate: 0 }
    row.moves += 1
    if (m.classification === 'blunder') row.blunders += 1
    acc.set(k, row)
  }
  for (const row of acc.values()) row.rate = row.moves ? row.blunders / row.moves : 0
  return acc
}

const bucketOf = (secs: number) =>
  TIME_BUCKETS.find((b) => secs >= b.lo && secs < b.hi)?.label ?? '60s+'

export interface GameRow {
  gameId: string
  date: string | null
  opponent: string
  result: 'w' | 'l' | 'd' | '?'
  accuracy: number | null
  worstMove: string | null
  plies: number
}

export interface Insights {
  totalGames: number
  totalPositions: number
  accuracy: number | null
  games: GameRow[]
  blunderRateByFamily: { family: string; rate: number; moves: number; blunders: number }[]
  blunderRateByPhase: { phase: string; rate: number; moves: number; blunders: number }[]
  timeBuckets: { label: string; accuracy: number | null; moves: number }[]
  accuracyByMonth: { month: string; accuracy: number; games: number }[]
  repeatedMistakes: { move: string; ply: number; count: number; fen: string }[]
  flex:
    | { gameId: string; opponent: string; accuracy: number; move: string | null; ply: number | null; fen: string }
    | null
  worstBlunder:
    | { gameId: string; opponent: string; ply: number; move: string; lossPct: number; fen: string; cliff: number[] }
    | null
  poisonOpening: { family: string; multiplier: number } | null
  timePressure: { overallAccuracy: number | null; underAccuracy: number | null; dropPct: number | null }
  worstDay: { date: string; games: number; blunders: number } | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
// Per-move accuracy, then mean — not the curve applied to the average loss
// (see accuracy.ts). moves here already excludes book plies (userMoves drops
// them), so there is no book-credit case to handle at this call site.
const accOf = (moves: readonly UserMove[]) => avg(moves.map((m) => moveAccuracyPct(m.lossPct)))

// Recomputes every final aggregate from the full joined data. The finalizer's
// core; deterministic and pure so it is unit-testable without any store.
export function computeInsights(games: readonly AnalyzedGame[]): Insights {
  const userGames = games.filter((g) => g.userColor)
  const allMoves = userGames.flatMap(userMoves)
  const totalPositions = games.reduce((n, g) => n + g.record.plies.length, 0)

  const perGameAcc = userGames.flatMap((g) => {
    const a = walkGame(g).accuracies[g.userColor as 'white' | 'black']
    return a === null ? [] : [{ g, accuracy: a }]
  })
  const overallAccuracy = accOf(allMoves)

  // Blunder rate by opening family and by phase.
  const famRates = [...ratesBy(allMoves, (m) => m.family).values()]
    .sort((a, b) => b.rate - a.rate)
    .map((r) => ({ family: r.key, rate: r.rate, moves: r.moves, blunders: r.blunders }))
  const phaseRates = [...ratesBy(allMoves, (m) => m.phase).values()].map((r) => ({
    phase: r.key,
    rate: r.rate,
    moves: r.moves,
    blunders: r.blunders,
  }))

  // Time-remaining buckets: accuracy of moves made with the clock in each band.
  const clocked = allMoves.filter((m) => m.clockAfter !== null)
  const timeBuckets = TIME_BUCKETS.map((b) => {
    const inBucket = clocked.filter((m) => bucketOf(m.clockAfter as number) === b.label)
    return { label: b.label, accuracy: accOf(inBucket), moves: inBucket.length }
  })
  const under30 = clocked.filter((m) => (m.clockAfter as number) < 30)
  const underAccuracy = accOf(under30)
  const timePressure = {
    overallAccuracy,
    underAccuracy,
    dropPct:
      overallAccuracy !== null && underAccuracy !== null ? overallAccuracy - underAccuracy : null,
  }

  // Accuracy trend by UTC month.
  const byMonth = new Map<string, number[]>()
  for (const { g, accuracy } of perGameAcc) {
    const month = g.game.date?.slice(0, 7)
    if (!month) continue
    ;(byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(accuracy)
  }
  const accuracyByMonth = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, xs]) => ({ month, accuracy: avg(xs) as number, games: xs.length }))

  // Most-repeated mistake positions: the same (position-before, move) blundered
  // across games. Keyed by the move list prefix so identical positions collide.
  const mistakes = new Map<string, { move: string; ply: number; count: number; gameId: string }>()
  for (const g of userGames) {
    for (const m of walkGame(g).moves) {
      if (m.classification !== 'blunder') continue
      const prefix = g.record.uciMoves.slice(0, m.ply - 1).join(' ')
      const key = `${prefix}|${m.played}`
      const row = mistakes.get(key) ?? { move: m.played, ply: m.ply, count: 0, gameId: g.gameId }
      row.count += 1
      mistakes.set(key, row)
    }
  }
  const repeatedMistakes = [...mistakes.entries()]
    .filter(([, r]) => r.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([key, r]) => ({
      move: r.move,
      ply: r.ply,
      count: r.count,
      fen: fenBeforePly(key.split('|')[0] ? key.split('|')[0].split(' ') : [], r.ply),
    }))

  // Flex: the highest-accuracy game, plus its best user "!" moment if one
  // exists (a non-book move where the user played the engine's top choice).
  // A minimum length keeps a five-move game (trivially near-100%) from winning;
  // fall back to all games only if nothing clears the bar.
  let flex: Insights['flex'] = null
  const flexPool = perGameAcc.filter((pg) => pg.g.record.plies.length >= 24)
  const flexCandidates = flexPool.length ? flexPool : perGameAcc
  if (flexCandidates.length) {
    const best = flexCandidates.reduce((a, b) => (b.accuracy > a.accuracy ? b : a))
    const bestWalk = walkGame(best.g)
    const brilliancies = bestWalk.moves.filter((m) => m.played === m.best && m.wpBefore < 85)
    const shown = brilliancies.length ? brilliancies[brilliancies.length - 1] : null
    flex = {
      gameId: best.g.gameId,
      opponent: bestWalk.opponent,
      accuracy: best.accuracy,
      move: shown?.played ?? null,
      ply: shown?.ply ?? null,
      fen: fenBeforePly(best.g.record.uciMoves, shown?.ply ?? best.g.record.uciMoves.length + 1),
    }
  }

  // Worst blunder: the single user move with the largest win-probability drop,
  // with a short win% series around it for the eval-cliff sparkline.
  let worstBlunder: Insights['worstBlunder'] = null
  {
    let worst: { g: AnalyzedGame; m: UserMove } | null = null
    for (const g of userGames) {
      for (const m of walkGame(g).moves) {
        if (!worst || m.lossPct > worst.m.lossPct) worst = { g, m }
      }
    }
    if (worst && worst.m.lossPct > 0) {
      const { g, m } = worst
      const cliff: number[] = []
      // Six plies of White-perspective win% straddling the blunder, read off
      // the game walk (one series per game, computed once).
      const worstWalk = walkGame(g)
      const series = worstWalk.whiteWinSeries
      for (let i = Math.max(0, m.ply - 2); i <= Math.min(series.length - 1, m.ply + 2); i++) {
        cliff.push(Math.round(series[i]))
      }
      worstBlunder = {
        gameId: g.gameId,
        opponent: worstWalk.opponent,
        ply: m.ply,
        move: m.played,
        lossPct: Math.round(m.lossPct),
        fen: fenBeforePly(g.record.uciMoves, m.ply),
        cliff,
      }
    }
  }

  // Poison opening: the family the user blunders in most, relative to their own
  // overall rate. Needs a minimum sample so a single bad game is not "poison".
  let poisonOpening: Insights['poisonOpening'] = null
  const overallRate = allMoves.length
    ? allMoves.filter((m) => m.classification === 'blunder').length / allMoves.length
    : 0
  if (overallRate > 0) {
    const candidates = famRates.filter((f) => f.moves >= 10 && f.rate > overallRate)
    if (candidates.length) {
      const top = candidates[0]
      poisonOpening = { family: top.family, multiplier: Math.round((top.rate / overallRate) * 10) / 10 }
    }
  }

  // Worst day: the UTC date with the most user blunders.
  const byDay = new Map<string, { games: Set<string>; blunders: number }>()
  for (const m of allMoves) {
    if (!m.date) continue
    const row = byDay.get(m.date) ?? { games: new Set(), blunders: 0 }
    row.games.add(m.gameId)
    if (m.classification === 'blunder') row.blunders += 1
    byDay.set(m.date, row)
  }
  let worstDay: Insights['worstDay'] = null
  for (const [date, row] of byDay) {
    if (row.blunders > 0 && (!worstDay || row.blunders > worstDay.blunders)) {
      worstDay = { date, games: row.games.size, blunders: row.blunders }
    }
  }

  // Per-game rows for the dashboard's game list. Computed once here so the
  // dashboard is a single read rather than a per-game join at page load.
  const gameRows: GameRow[] = userGames.map((g) => {
    const walk = walkGame(g)
    const ms = walk.moves
    const acc = walk.accuracies[g.userColor as 'white' | 'black']
    const worst = ms.reduce<UserMove | null>((a, m) => (!a || m.lossPct > a.lossPct ? m : a), null)
    const opponent = walk.opponent
    return {
      gameId: g.gameId,
      date: g.game.date,
      opponent,
      result: outcomeFor(g.game.result, g.userColor),
      accuracy: acc,
      worstMove: worst && worst.classification !== 'none' ? worst.played : null,
      plies: g.record.plies.length,
    }
  })

  return {
    totalGames: games.length,
    totalPositions,
    accuracy: overallAccuracy,
    games: gameRows,
    blunderRateByFamily: famRates,
    blunderRateByPhase: phaseRates,
    timeBuckets,
    accuracyByMonth,
    repeatedMistakes,
    flex,
    worstBlunder,
    poisonOpening,
    timePressure,
    worstDay,
  }
}
