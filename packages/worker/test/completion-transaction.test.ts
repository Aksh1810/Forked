import { expect, test } from 'vitest'
import type { RingEntry } from '@forked/shared'
import { buildCompletionTransaction, type CompletionOutcome } from '../src/completion.js'

const ringEntry: RingEntry = { gameId: 'g1', accuracy: 91.2, finishedAt: 't1', opp: 'rival', res: 'w', plies: 36 }
const done: CompletionOutcome = {
  kind: 'done',
  attempts: 1,
  ringEntry,
  contribution: {
    family: 'Sicilian Defense',
    accuracy: 91.2,
    moves: 18,
    blunders: 2,
    phaseMoves: { opening: 4, middlegame: 14 },
    phaseBlunders: { middlegame: 2 },
  },
}

test('done transaction: conditional flip, counter, ring, aggregates in ONE call', () => {
  const tx = buildCompletionTransaction('t', 'job1', 'g1', done, [], 'now')
  expect(tx.TransactItems).toHaveLength(2)

  const game = tx.TransactItems![0].Update!
  expect(game.Key).toEqual({ pk: 'JOB#job1', sk: 'GAME#g1' })
  expect(game.ConditionExpression).toBe('#st = :pending')
  expect(game.ExpressionAttributeValues![':final']).toBe('done')

  const job = tx.TransactItems![1].Update!
  expect(job.Key).toEqual({ pk: 'JOB#job1', sk: 'META' })
  expect(job.ConditionExpression).toBe('attribute_exists(pk)')
  expect(job.UpdateExpression).toContain('ADD #counter :one')
  expect(job.ExpressionAttributeNames!['#counter']).toBe('completed')
  expect(job.UpdateExpression).toContain('agg.opm.#fam :moves')
  expect(job.UpdateExpression).toContain('agg.opb.#fam :blunders')
  expect(job.ExpressionAttributeNames!['#fam']).toBe('Sicilian Defense')
  expect(job.UpdateExpression).toContain('agg.phm.#pm_middlegame :pm_middlegame')
  expect(job.UpdateExpression).toContain('agg.phb.#pb_middlegame :pb_middlegame')
  expect(job.UpdateExpression).toContain('agg.accSum :accSum')
  expect(job.UpdateExpression).toContain('SET ring = :ring')
  expect(job.ExpressionAttributeValues![':ring']).toEqual([ringEntry])
})

test('ring is merged onto the current ring, capped at 20', () => {
  const current = Array.from({ length: 20 }, (_, i) => ({
    gameId: `old${i}`,
    accuracy: null,
    finishedAt: `t${i}`,
    opp: 'rival',
    res: '?' as const,
    plies: 10,
  }))
  const tx = buildCompletionTransaction('t', 'job1', 'g1', done, current, 'now')
  const ring = tx.TransactItems![1].Update!.ExpressionAttributeValues![':ring'] as RingEntry[]
  expect(ring).toHaveLength(20)
  expect(ring[19]).toEqual(ringEntry)
  expect(ring[0].gameId).toBe('old1')
})

test('failed transaction increments only the failed counter and stores the error', () => {
  const failed: CompletionOutcome = { kind: 'failed', error: 'poison', attempts: 5 }
  const tx = buildCompletionTransaction('t', 'job1', 'g1', failed, [], 'now')
  const game = tx.TransactItems![0].Update!
  expect(game.ExpressionAttributeValues![':final']).toBe('failed')
  expect(game.ExpressionAttributeValues![':err']).toBe('poison')
  const job = tx.TransactItems![1].Update!
  expect(job.ExpressionAttributeNames!['#counter']).toBe('failed')
  expect(job.UpdateExpression).not.toContain('ring')
  expect(job.UpdateExpression).not.toContain('agg.')
})

test('null accuracy contributes no accuracy terms', () => {
  const noAcc: CompletionOutcome = {
    ...done,
    contribution: { ...done.contribution, accuracy: null },
    ringEntry: { ...ringEntry, accuracy: null },
  }
  const tx = buildCompletionTransaction('t', 'job1', 'g1', noAcc, [], 'now')
  expect(tx.TransactItems![1].Update!.UpdateExpression).not.toContain('accSum')
})
