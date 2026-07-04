import { expect, test } from 'vitest'
import {
  EngineRecordSchema,
  EvalSchema,
  PlyAnalysisSchema,
  type EngineRecord,
  type PlyAnalysis,
} from '../src/schemas.js'

// TYPE-LEVEL PROOF: the engine record schema contains no clock or
// player-identity fields. If anyone ever adds one, this stops compiling
// (typecheck runs over tests via tsconfig.tests.json).
type ForbiddenGameFields =
  | 'clock'
  | 'clocks'
  | 'clk'
  | 'white'
  | 'black'
  | 'whiteName'
  | 'blackName'
  | 'player'
  | 'players'
  | 'gameId'
  | 'date'
  | 'timestamp'
  | 'timeControl'
  | 'result'
type EngineRecordKeys = keyof EngineRecord | keyof PlyAnalysis
type Overlap = Extract<EngineRecordKeys, ForbiddenGameFields>
const engineRecordHasNoGameSpecificFields: Overlap extends never ? true : never = true

const validPly: PlyAnalysis = {
  ply: 1,
  played: 'e2e4',
  best: 'e2e4',
  pv: ['e2e4', 'e7e5'],
  evalAfter: { type: 'cp', value: 20 },
  classification: 'none',
  book: true,
}

const validRecord: EngineRecord = {
  cacheKey: 'abc',
  engineVersion: 'Stockfish 18',
  nodeBudget: 600_000,
  uciMoves: ['e2e4'],
  startEval: { type: 'cp', value: 20 },
  plies: [validPly],
}

test('type-level proof stays referenced', () => {
  expect(engineRecordHasNoGameSpecificFields).toBe(true)
})

test('valid engine record parses', () => {
  expect(EngineRecordSchema.parse(validRecord)).toEqual(validRecord)
})

test('strict schema rejects smuggled clock data on the record', () => {
  expect(EngineRecordSchema.safeParse({ ...validRecord, clocks: [178, 177] }).success).toBe(false)
})

test('strict schema rejects smuggled clock or identity data on a ply', () => {
  expect(PlyAnalysisSchema.safeParse({ ...validPly, clk: 178 }).success).toBe(false)
  expect(
    EngineRecordSchema.safeParse({
      ...validRecord,
      plies: [{ ...validPly, white: 'alice' }],
    }).success,
  ).toBe(false)
})

test('mate zero is never a stored evaluation', () => {
  expect(EvalSchema.safeParse({ type: 'mate', value: 0 }).success).toBe(false)
  expect(EvalSchema.safeParse({ type: 'mate', value: 2 }).success).toBe(true)
})

test('pv is trimmed to at most 6 plies', () => {
  expect(
    PlyAnalysisSchema.safeParse({ ...validPly, pv: ['a2a3', 'a7a6', 'b2b3', 'b7b6', 'c2c3', 'c7c6', 'd2d3'] })
      .success,
  ).toBe(false)
})
