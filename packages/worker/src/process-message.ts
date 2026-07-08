import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { gameKey, metricsKey, type GameTask } from '@forked/shared'
import { getEngineRecord, putEngineRecord } from './cache.js'
import { buildDoneOutcome } from './contribution.js'
import { executeCompletion } from './completion.js'
import type { Deps } from './db.js'
import { tryFinalize } from './finalize.js'
import { log } from './log.js'
import { analyzeGame } from './analyze.js'
import type { Engine } from './uci.js'

export type TaskResult = 'completed' | 'duplicate' | 'orphan'

// Processes one game task. Throwing here leaves the message undeleted, so
// SQS redelivers it (at-least-once) and after maxReceiveCount it reaches the
// DLQ; the idempotent completion transaction makes all of that harmless.
export async function processTask(
  deps: Deps,
  engine: Engine,
  task: GameTask,
  attempts: number,
): Promise<TaskResult> {
  const { jobId, gameId } = task
  const out = await deps.ddb.send(
    new GetCommand({ TableName: deps.table, Key: gameKey(jobId, gameId) }),
  )
  const game = out.Item
  if (!game) {
    log('warn', 'task for unknown game item', { jobId, gameId })
    return 'orphan'
  }
  if (game.status !== 'pending') {
    log('info', 'duplicate delivery for settled game', { jobId, gameId, status: game.status })
    return 'duplicate'
  }

  log('info', 'processing game', { jobId, gameId, attempts, cacheKey: game.cacheKey })
  let record = await getEngineRecord(deps, game.cacheKey)
  const cacheHit = record !== null
  if (!record) {
    record = await analyzeGame(engine, game.uciMoves, { nodeBudget: game.nodeBudget })
    if (record.cacheKey !== game.cacheKey) {
      // Deployment misconfiguration: the running engine does not match the
      // pinned version ingest keyed the cache with. Fail loudly.
      throw new Error(
        `cache key mismatch for ${jobId}/${gameId}: ingest ${game.cacheKey}, engine produced ${record.cacheKey} (${record.engineVersion})`,
      )
    }
    await putEngineRecord(deps, record)
  }

  const outcome = buildDoneOutcome(
    { gameId, uciMoves: game.uciMoves, userColor: game.userColor ?? null, game: game.game },
    record,
    attempts,
  )
  const result = await executeCompletion(deps, jobId, gameId, outcome)
  log('info', 'game completed', { jobId, gameId, result, cacheHit, accuracy: outcome.ringEntry.accuracy })
  if (result === 'applied' && !cacheHit) {
    // Landing-page ticker counter. Fire and forget: approximate by design,
    // never blocks or fails the completion path. Cache hits do not tick;
    // those positions were judged once already.
    deps.ddb
      .send(
        new UpdateCommand({
          TableName: deps.table,
          Key: metricsKey('TOTAL'),
          UpdateExpression: 'ADD positions :p, games :one',
          ExpressionAttributeValues: { ':p': record.plies.length, ':one': 1 },
        }),
      )
      .catch((err) => log('warn', 'metrics tick failed', { jobId, gameId, error: String(err) }))
  }
  if (result === 'applied') await tryFinalize(deps, jobId)
  return 'completed'
}
