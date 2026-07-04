import { z } from 'zod'
import { GameRecordSchema } from './schemas.js'

export const JobStatusSchema = z.enum(['ingesting', 'analyzing', 'finalizing', 'complete', 'failed'])
export type JobStatus = z.infer<typeof JobStatusSchema>

export const GameStatusSchema = z.enum(['pending', 'done', 'failed'])
export type GameStatus = z.infer<typeof GameStatusSchema>

// Ring buffer entry: drives the live progress UI's stream of completed games.
export const RingEntrySchema = z.strictObject({
  gameId: z.string(),
  accuracy: z.number().nullable(),
  finishedAt: z.string(),
})
export type RingEntry = z.infer<typeof RingEntrySchema>

// Compact running aggregates on the job item, updated from the completion
// path with race-free ADDs. A preview mechanism only: the finalizer
// recomputes all final aggregates from the full data.
export const PartialAggSchema = z.strictObject({
  accSum: z.number(),
  accCnt: z.number(),
  opb: z.record(z.string(), z.number()), // opening family -> user blunders
  opm: z.record(z.string(), z.number()), // opening family -> user classified moves
  phb: z.record(z.string(), z.number()), // phase -> user blunders
  phm: z.record(z.string(), z.number()), // phase -> user classified moves
})
export type PartialAgg = z.infer<typeof PartialAggSchema>

export const emptyPartialAgg = (): PartialAgg => ({
  accSum: 0,
  accCnt: 0,
  opb: {},
  opm: {},
  phb: {},
  phm: {},
})

// The job item's counters are a fast-read optimization; game items are the
// source of truth and the janitor can rebuild the counters from them.
export const JobItemSchema = z.object({
  jobId: z.string(),
  username: z.string().nullable(),
  status: JobStatusSchema,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  nodeBudget: z.number().int().positive(),
  ring: z.array(RingEntrySchema).max(20),
  agg: PartialAggSchema,
  createdAt: z.string(),
  deadlineAt: z.string(),
  completedAt: z.string().optional(),
})
export type JobItem = z.infer<typeof JobItemSchema>

export const GameItemSchema = z.object({
  jobId: z.string(),
  gameId: z.string(),
  status: GameStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().optional(),
  cacheKey: z.string(),
  uciMoves: z.array(z.string()),
  userColor: z.enum(['white', 'black']).nullable(),
  nodeBudget: z.number().int().positive(),
  game: GameRecordSchema,
  finishedAt: z.string().optional(),
})
export type GameItem = z.infer<typeof GameItemSchema>

// SQS message body: deliberately minimal, the game item holds the payload.
export const GameTaskSchema = z.strictObject({
  jobId: z.string(),
  gameId: z.string(),
})
export type GameTask = z.infer<typeof GameTaskSchema>
