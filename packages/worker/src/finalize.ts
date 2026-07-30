import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { BatchGetCommand, DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  EngineRecordSchema,
  buildWrappedSummary,
  cacheItemKey,
  jobKey,
  lockKey,
  type AnalyzedGame,
  type EngineRecord,
} from '@forked/shared'
import type { Deps } from './db.js'
import { log } from './log.js'

// THE FINALIZER CLAIM. Whichever completion observes that completed plus
// failed now equals total attempts a conditional flip from analyzing to
// finalizing; exactly one caller wins. The winner recomputes all final
// aggregates from the full game data, writes the wrapped summary, marks the
// job complete, and releases the per-username lock. Idempotent by the claim:
// a duplicate or janitor-triggered call whose flip fails simply returns false.
export async function tryFinalize(deps: Deps, jobId: string): Promise<boolean> {
  const out = await deps.ddb.send(
    new GetCommand({
      TableName: deps.table,
      Key: jobKey(jobId),
      // Consistent read: the last completer must see its own counter bump, or
      // a done job idles in analyzing until the janitor's next sweep.
      ConsistentRead: true,
      ProjectionExpression: '#st, #tot, completed, failed, username',
      ExpressionAttributeNames: { '#st': 'status', '#tot': 'total' },
    }),
  )
  const job = out.Item
  if (!job || job.status !== 'analyzing' || job.completed + job.failed < job.total) return false

  try {
    await deps.ddb.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: jobKey(jobId),
        ConditionExpression: '#st = :analyzing',
        UpdateExpression: 'SET #st = :finalizing',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':analyzing': 'analyzing', ':finalizing': 'finalizing' },
      }),
    )
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false // another caller won
    throw err
  }

  await finalizeJob(deps, jobId, typeof job.username === 'string' ? job.username : null)
  return true
}

// Does the actual finalization: recompute the wrapped summary, write it with
// the complete flip, release the lock. Idempotent (deterministic summary,
// idempotent SET), so the janitor can safely re-drive a job whose finalizer
// won the claim then crashed before completing. Separated from the claim for
// exactly that reason.
export async function finalizeJob(deps: Deps, jobId: string, username: string | null): Promise<void> {
  const games = await loadAnalyzedGames(deps, jobId)
  const wrapped = buildWrappedSummary(games, { username, generatedAt: new Date().toISOString() })

  await deps.ddb.send(
    new UpdateCommand({
      TableName: deps.table,
      Key: jobKey(jobId),
      // "wrapped" is a DynamoDB reserved word, so it must go through a name.
      UpdateExpression:
        'SET #st = :complete, completedAt = :now, #wrapped = :wrapped REMOVE gsi1pk, gsi1sk',
      ExpressionAttributeNames: { '#st': 'status', '#wrapped': 'wrapped' },
      ExpressionAttributeValues: { ':complete': 'complete', ':now': new Date().toISOString(), ':wrapped': wrapped },
    }),
  )

  // Release the per-username lock, conditioned on it still pointing at this
  // job so a lock re-acquired for a newer job survives.
  if (username) {
    await deps.ddb
      .send(
        new DeleteCommand({
          TableName: deps.table,
          Key: lockKey(username),
          ConditionExpression: 'jobId = :j',
          ExpressionAttributeValues: { ':j': jobId },
        }),
      )
      .catch(() => {}) // already released or re-acquired
  }

  log('info', 'job finalized', { jobId, archetype: wrapped.archetype.key, accuracy: wrapped.accuracy })
}

// Joins every done game's record with its content-addressed engine record.
// Failed games have no engine record and contribute nothing, so they are
// skipped. Engine records are fetched once per unique cacheKey (cache hits
// share one).
async function loadAnalyzedGames(deps: Deps, jobId: string): Promise<AnalyzedGame[]> {
  const gameItems: Record<string, unknown>[] = []
  let start: Record<string, unknown> | undefined
  do {
    const page = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :g)',
        ExpressionAttributeValues: { ':pk': `JOB#${jobId}`, ':g': 'GAME#' },
        ExclusiveStartKey: start,
      }),
    )
    gameItems.push(...((page.Items ?? []) as Record<string, unknown>[]))
    start = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (start)

  const done = gameItems.filter((g) => g.status === 'done')
  const cacheKeys = [...new Set(done.map((g) => g.cacheKey as string))]
  const records = await loadEngineRecords(deps, cacheKeys)

  const analyzed: AnalyzedGame[] = []
  for (const g of done) {
    const record = records.get(g.cacheKey as string)
    if (!record) {
      log('warn', 'done game missing its engine record at finalize', { jobId, gameId: g.gameId })
      continue
    }
    analyzed.push({
      gameId: g.gameId as string,
      userColor: (g.userColor ?? null) as 'white' | 'black' | null,
      game: g.game as AnalyzedGame['game'],
      record,
    })
  }
  return analyzed
}

async function loadEngineRecords(deps: Deps, cacheKeys: string[]): Promise<Map<string, EngineRecord>> {
  const out = new Map<string, EngineRecord>()
  for (let i = 0; i < cacheKeys.length; i += 100) {
    let keys = cacheKeys.slice(i, i + 100).map((k) => cacheItemKey(k))
    while (keys.length) {
      const res = await deps.ddb.send(new BatchGetCommand({ RequestItems: { [deps.table]: { Keys: keys } } }))
      for (const item of res.Responses?.[deps.table] ?? []) {
        const rec = EngineRecordSchema.parse((item as { record: unknown }).record)
        out.set(rec.cacheKey, rec)
      }
      const un = res.UnprocessedKeys?.[deps.table]?.Keys
      keys = un ? (un as { pk: string; sk: string }[]) : []
      if (keys.length) await new Promise((r) => setTimeout(r, 100))
    }
  }
  return out
}
