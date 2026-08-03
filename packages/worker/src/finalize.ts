import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { jobKey, lockKey } from '@forked/shared'
import type { Deps } from './db.js'
import { log } from './log.js'

// THE FINALIZER CLAIM. Whichever completion observes that completed plus
// failed now equals total attempts a conditional flip from analyzing to
// finalizing; exactly one caller wins. The winner marks the job complete,
// drops it off the janitor's sweep GSI, and releases the per-username lock.
// Idempotent by the claim: a duplicate or janitor-triggered call whose flip
// fails simply returns false.
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

// Does the actual finalization: flip the job complete, drop it off the sparse
// GSI the janitor sweeps, release the lock. Idempotent (all plain SETs), so the
// janitor can safely re-drive a job whose finalizer won the claim then crashed
// before completing. Separated from the claim for exactly that reason.
export async function finalizeJob(deps: Deps, jobId: string, username: string | null): Promise<void> {
  await deps.ddb.send(
    new UpdateCommand({
      TableName: deps.table,
      Key: jobKey(jobId),
      // "status" is a DynamoDB reserved word, so it goes through a name.
      UpdateExpression: 'SET #st = :complete, completedAt = :now REMOVE gsi1pk, gsi1sk',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':complete': 'complete', ':now': new Date().toISOString() },
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

  log('info', 'job finalized', { jobId })
}
