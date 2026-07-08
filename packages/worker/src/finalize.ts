import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { BatchGetCommand, DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  EngineRecordSchema,
  buildWrappedSummary,
  cacheItemKey,
  jobKey,
  leaderBlunderKey,
  leaderUserKey,
  lockKey,
  type AnalyzedGame,
  type EngineRecord,
  type WrappedSummary,
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

  // Before the job write, so the percentile it computes rides along on the
  // wrapped summary instead of costing a second update.
  if (username) await updateLeaderboard(deps, jobId, username, wrapped)

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

// Leaderboard snapshots plus the wrapped accuracy percentile. Every write is
// conditional and idempotent, so a janitor re-driven finalize can never
// double-count or regress the board. Exported for its unit test only.
export async function updateLeaderboard(
  deps: Deps,
  jobId: string,
  username: string,
  wrapped: WrappedSummary,
): Promise<void> {
  if (wrapped.accuracy !== null) {
    // ponytail: one Query page; the LEADER partition would need thousands of
    // users before pagination matters.
    const out = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :u)',
        ExpressionAttributeValues: { ':pk': 'LEADER', ':u': 'USER#' },
      }),
    )
    const ranked = ((out.Items ?? []) as { accuracy?: number; games?: number; optOut?: boolean }[]).filter(
      (u) => typeof u.accuracy === 'number' && (u.games ?? 0) >= 50 && !u.optOut,
    )
    if (ranked.length >= 10) {
      const below = ranked.filter((u) => (u.accuracy as number) < (wrapped.accuracy as number)).length
      wrapped.accuracyPercentile = Math.round((below / ranked.length) * 100)
    }

    // Biggest-job snapshot: a 300-game wrapped is never overwritten by a
    // 5-game one. Never touches optOut, so an opt-out survives re-analysis.
    await deps.ddb
      .send(
        new UpdateCommand({
          TableName: deps.table,
          Key: leaderUserKey(username),
          ConditionExpression: 'attribute_not_exists(games) OR games <= :g',
          UpdateExpression:
            'SET username = :u, accuracy = :a, games = :g, archetype = :arch, updatedAt = :now',
          ExpressionAttributeValues: {
            ':u': username,
            ':a': wrapped.accuracy,
            ':g': wrapped.totalGames,
            ':arch': { key: wrapped.archetype.key, name: wrapped.archetype.name, mark: wrapped.archetype.mark },
            ':now': new Date().toISOString(),
          },
        }),
      )
      .catch(swallowConditional)
  }

  const b = wrapped.worstBlunder
  if (b) {
    // Blunder of the day: biggest win-percent loss wins the slot; the TTL
    // clears stale days without a cleanup job.
    // ponytail: dated at (re-)drive time, so a janitor re-drive that crosses
    // UTC midnight can post the same blunder into a second day. Rare crash
    // window, mild consequence; key by job createdAt if it ever matters.
    await deps.ddb
      .send(
        new UpdateCommand({
          TableName: deps.table,
          Key: leaderBlunderKey(new Date().toISOString().slice(0, 10)),
          ConditionExpression: 'attribute_not_exists(lossPct) OR lossPct < :l',
          UpdateExpression:
            'SET username = :u, jobId = :j, gameId = :g, opponent = :o, #mv = :m, ply = :p, lossPct = :l, fen = :f, cliff = :c, #ttl = :ttl',
          ExpressionAttributeNames: { '#mv': 'move', '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':u': username,
            ':j': jobId,
            ':g': b.gameId,
            ':o': b.opponent,
            ':m': b.move,
            ':p': b.ply,
            ':l': b.lossPct,
            ':f': b.fen,
            ':c': b.cliff,
            ':ttl': Math.floor(Date.now() / 1000) + 7 * 86_400,
          },
        }),
      )
      .catch(swallowConditional)
  }
}

const swallowConditional = (err: unknown): void => {
  if (!(err instanceof ConditionalCheckFailedException)) throw err
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
