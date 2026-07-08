import { z } from 'zod'
import { archetype, computeArchetypeFeatures } from './archetype.js'
import { selectDelighter, type Delighter } from './delighter.js'
import { computeInsights, type AnalyzedGame } from './insights.js'

// THE WRAPPED SUMMARY. One object, computed once by the finalizer, from which
// the story, both card sizes, and the OG image all render, so those surfaces
// can never disagree. It is the single read model for a finished job.
const BoardMomentSchema = z.strictObject({
  gameId: z.string(),
  opponent: z.string(),
  ply: z.number().int().nullable(),
  move: z.string().nullable(),
  fen: z.string(),
})

const DelighterSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('longest-game'), plies: z.number().int(), opponent: z.string() }),
  z.strictObject({ kind: z.literal('most-faced'), opponent: z.string(), count: z.number().int() }),
  z.strictObject({ kind: z.literal('blundered-square'), square: z.string(), count: z.number().int() }),
  z.strictObject({ kind: z.literal('favorite-piece'), piece: z.string(), count: z.number().int() }),
  z.strictObject({ kind: z.literal('comebacks'), count: z.number().int() }),
])

export const WrappedSummarySchema = z.strictObject({
  version: z.literal(1),
  generatedAt: z.string(),
  username: z.string().nullable(),
  totalGames: z.number().int(),
  totalPositions: z.number().int(),
  accuracy: z.number().nullable(),
  // Filled once leaderboard data supports it; omitted gracefully before.
  accuracyPercentile: z.number().nullable(),
  flex: BoardMomentSchema.extend({ accuracy: z.number() }).nullable(),
  worstBlunder: z
    .strictObject({
      gameId: z.string(),
      opponent: z.string(),
      ply: z.number().int(),
      move: z.string(),
      lossPct: z.number(),
      fen: z.string(),
      cliff: z.array(z.number()),
    })
    .nullable(),
  poisonOpening: z.strictObject({ family: z.string(), multiplier: z.number() }).nullable(),
  timePressure: z.strictObject({
    overallAccuracy: z.number().nullable(),
    underAccuracy: z.number().nullable(),
    dropPct: z.number().nullable(),
    buckets: z.array(
      z.strictObject({ label: z.string(), accuracy: z.number().nullable(), moves: z.number().int() }),
    ),
  }),
  worstDay: z.strictObject({ date: z.string(), games: z.number().int(), blunders: z.number().int() }).nullable(),
  delighter: DelighterSchema.nullable(),
  archetype: z.strictObject({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    mark: z.string(),
  }),
  // Dashboard aggregates. Compact by construction (a handful of rows each).
  accuracyByMonth: z.array(
    z.strictObject({ month: z.string(), accuracy: z.number(), games: z.number().int() }),
  ),
  blunderRateByFamily: z.array(
    z.strictObject({
      family: z.string(),
      rate: z.number(),
      moves: z.number().int(),
      blunders: z.number().int(),
    }),
  ),
  blunderRateByPhase: z.array(
    z.strictObject({
      phase: z.string(),
      rate: z.number(),
      moves: z.number().int(),
      blunders: z.number().int(),
    }),
  ),
  repeatedMistakes: z.array(
    z.strictObject({
      move: z.string(),
      ply: z.number().int(),
      count: z.number().int(),
      fen: z.string(),
    }),
  ),
  games: z.array(
    z.strictObject({
      gameId: z.string(),
      date: z.string().nullable(),
      opponent: z.string(),
      result: z.enum(['w', 'l', 'd', '?']),
      accuracy: z.number().nullable(),
      worstMove: z.string().nullable(),
      plies: z.number().int(),
    }),
  ),
})
export type WrappedSummary = z.infer<typeof WrappedSummarySchema>
export type { Delighter }

// Assembles the wrapped summary from the joined games. Pure and deterministic:
// same games and timestamp produce byte-identical output, so a re-run finalizer
// (janitor path) cannot disagree with the worker path.
export function buildWrappedSummary(
  games: readonly AnalyzedGame[],
  opts: { username: string | null; generatedAt: string },
): WrappedSummary {
  const ins = computeInsights(games)
  const feats = computeArchetypeFeatures(games, ins.timePressure.dropPct)
  return {
    version: 1,
    generatedAt: opts.generatedAt,
    username: opts.username,
    totalGames: ins.totalGames,
    totalPositions: ins.totalPositions,
    accuracy: ins.accuracy,
    accuracyPercentile: null,
    flex: ins.flex,
    worstBlunder: ins.worstBlunder,
    poisonOpening: ins.poisonOpening,
    timePressure: {
      overallAccuracy: ins.timePressure.overallAccuracy,
      underAccuracy: ins.timePressure.underAccuracy,
      dropPct: ins.timePressure.dropPct,
      buckets: ins.timeBuckets,
    },
    worstDay: ins.worstDay,
    delighter: selectDelighter(games),
    archetype: archetype(feats),
    accuracyByMonth: ins.accuracyByMonth,
    blunderRateByFamily: ins.blunderRateByFamily,
    blunderRateByPhase: ins.blunderRateByPhase,
    repeatedMistakes: ins.repeatedMistakes,
    games: ins.games,
  }
}
