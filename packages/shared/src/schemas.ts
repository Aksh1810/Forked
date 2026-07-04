import { z } from 'zod'

// Evaluations are ALWAYS stored from White's perspective; normalization from
// the engine's side-to-move perspective happens at the UCI wrapper boundary.
// Mate values are signed plies-to-mate in full moves: positive means White
// mates in value, negative means Black mates in |value|. Mate scores are never
// mixed into centipawn arithmetic; win probability maps them to 100 or 0.
export const EvalSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('cp'), value: z.number().int() }),
  z.strictObject({
    type: z.literal('mate'),
    value: z
      .number()
      .int()
      .refine((v) => v !== 0, 'mate 0 is never stored; terminal plies store evalAfter null'),
  }),
])
export type Eval = z.infer<typeof EvalSchema>

export const ClassificationSchema = z.enum(['blunder', 'mistake', 'inaccuracy', 'none'])
export type Classification = z.infer<typeof ClassificationSchema>

// ENGINE RECORD: cacheable, content-addressed by (moves, engine, node budget).
// It must contain NOTHING game-specific: no clocks, no player names, no
// timestamps, no game identifiers. That separation is enforced structurally
// (these strict schemas simply have no such fields) and by tests.
export const PlyAnalysisSchema = z.strictObject({
  ply: z.number().int().min(1),
  played: z.string(),
  best: z.string(),
  pv: z.array(z.string()).max(6),
  // null only for a game-ending checkmate or stalemate position, which is
  // never sent to the engine; readers derive the outcome from the game record.
  evalAfter: EvalSchema.nullable(),
  classification: ClassificationSchema,
  book: z.boolean(),
})
export type PlyAnalysis = z.infer<typeof PlyAnalysisSchema>

export const EngineRecordSchema = z.strictObject({
  cacheKey: z.string(),
  engineVersion: z.string(),
  nodeBudget: z.number().int().positive(),
  uciMoves: z.array(z.string()),
  startEval: EvalSchema,
  plies: z.array(PlyAnalysisSchema),
})
export type EngineRecord = z.infer<typeof EngineRecordSchema>

// GAME RECORD: never cached, never shared between games. Holds everything
// game-specific, including per-ply clock data, plus the cacheKey pointing at
// the engine record it joins with at read time.
export const PlayerSchema = z.strictObject({
  name: z.string(),
  rating: z.number().int().nullable(),
})

export const GameRecordSchema = z.strictObject({
  gameId: z.string(),
  white: PlayerSchema,
  black: PlayerSchema,
  timeControl: z.string(),
  result: z.enum(['1-0', '0-1', '1/2-1/2', '*']),
  date: z.string().nullable(),
  // seconds remaining after each ply, from %clk PGN comments; null when absent
  clocks: z.array(z.number().nullable()),
  eco: z.string().nullable(),
  openingName: z.string().nullable(),
  cacheKey: z.string(),
})
export type GameRecord = z.infer<typeof GameRecordSchema>
