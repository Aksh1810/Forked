import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import {
  gameKey,
  jobKey,
  mergeRing,
  type GameAggContribution,
  type RingEntry,
} from '@forked/shared'
import type { Deps } from './db.js'

export type CompletionOutcome =
  | { kind: 'done'; ringEntry: RingEntry; contribution: GameAggContribution; attempts: number }
  | { kind: 'failed'; error: string; attempts: number }

type TransactInput = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]>

// THE COMPLETION TRANSACTION. Every game completion, success or failure,
// goes through exactly this one TransactWriteItems call, which atomically
// (a) conditionally flips the game item from pending to done or failed,
// (b) increments the job's counter, and (c) updates the job's ring buffer
// and partial aggregates. The condition on (a) makes the whole transaction
// idempotent under SQS's at-least-once delivery: a duplicate attempt's
// condition fails and nothing is double-counted. There is NO other code path
// anywhere that increments the job counters.
//
// Pure builder, unit-tested without DynamoDB; executeCompletion wraps it.
export function buildCompletionTransaction(
  table: string,
  jobId: string,
  gameId: string,
  outcome: CompletionOutcome,
  currentRing: readonly RingEntry[],
  now: string,
): TransactInput {
  const gameUpdate = {
    TableName: table,
    Key: gameKey(jobId, gameId),
    ConditionExpression: '#st = :pending',
    UpdateExpression:
      'SET #st = :final, attempts = :attempts, finishedAt = :now' +
      (outcome.kind === 'failed' ? ', #err = :err' : ''),
    ExpressionAttributeNames: {
      '#st': 'status',
      ...(outcome.kind === 'failed' ? { '#err': 'error' } : {}),
    },
    ExpressionAttributeValues: {
      ':pending': 'pending',
      ':final': outcome.kind,
      ':attempts': outcome.attempts,
      ':now': now,
      ...(outcome.kind === 'failed' ? { ':err': outcome.error } : {}),
    },
  }

  const names: Record<string, string> = { '#counter': outcome.kind === 'done' ? 'completed' : 'failed' }
  const values: Record<string, unknown> = { ':one': 1 }
  const adds = ['#counter :one']
  let set = ''
  if (outcome.kind === 'done') {
    const c = outcome.contribution
    names['#fam'] = c.family
    values[':moves'] = c.moves
    values[':blunders'] = c.blunders
    adds.push('agg.opm.#fam :moves', 'agg.opb.#fam :blunders')
    for (const [phase, n] of Object.entries(c.phaseMoves)) {
      names[`#pm_${phase}`] = phase
      values[`:pm_${phase}`] = n
      adds.push(`agg.phm.#pm_${phase} :pm_${phase}`)
    }
    for (const [phase, n] of Object.entries(c.phaseBlunders)) {
      names[`#pb_${phase}`] = phase
      values[`:pb_${phase}`] = n
      adds.push(`agg.phb.#pb_${phase} :pb_${phase}`)
    }
    if (c.accuracy !== null) {
      values[':accSum'] = c.accuracy
      adds.push('agg.accSum :accSum', 'agg.accCnt :one')
    }
    set = 'SET ring = :ring'
    values[':ring'] = mergeRing(currentRing, outcome.ringEntry)
  }

  const jobUpdate = {
    TableName: table,
    Key: jobKey(jobId),
    ConditionExpression: 'attribute_exists(pk)',
    UpdateExpression: `ADD ${adds.join(', ')}${set ? ` ${set}` : ''}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }

  return { TransactItems: [{ Update: gameUpdate }, { Update: jobUpdate }] }
}

// Returns 'applied' when this call performed the completion, 'noop' when the
// game was already done or failed (duplicate delivery). The SQS message must
// be deleted only AFTER this returns; a crash before deletion causes a
// redelivery whose transaction simply no-ops. That is exactly-once
// accounting built on top of at-least-once delivery.
export async function executeCompletion(
  deps: Deps,
  jobId: string,
  gameId: string,
  outcome: CompletionOutcome,
): Promise<'applied' | 'noop'> {
  const job = await deps.ddb.send(
    new GetCommand({ TableName: deps.table, Key: jobKey(jobId), ProjectionExpression: 'ring' }),
  )
  const ring = (job.Item?.ring ?? []) as RingEntry[]
  const tx = buildCompletionTransaction(deps.table, jobId, gameId, outcome, ring, new Date().toISOString())
  try {
    await deps.ddb.send(new TransactWriteCommand(tx))
    return 'applied'
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const [gameReason, jobReason] = err.CancellationReasons ?? []
      if (gameReason?.Code === 'ConditionalCheckFailed') return 'noop'
      if (jobReason?.Code === 'ConditionalCheckFailed') {
        throw new Error(`job item missing for ${jobId}; refusing to account game ${gameId}`, {
          cause: err,
        })
      }
    }
    throw err
  }
}
