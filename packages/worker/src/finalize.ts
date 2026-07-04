import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { jobKey } from '@blunderfarm/shared'
import type { Deps } from './db.js'
import { log } from './log.js'

// THE FINALIZER CLAIM. Whichever completion observes that completed plus
// failed now equals total attempts a conditional flip from analyzing to
// finalizing; exactly one caller wins. Phase 4 expands the winner's work to
// the full aggregate recompute, wrapped summary, and lock release; for now
// the job is simply marked complete and leaves the sparse status GSI.
export async function tryFinalize(deps: Deps, jobId: string): Promise<boolean> {
  const out = await deps.ddb.send(
    new GetCommand({
      TableName: deps.table,
      Key: jobKey(jobId),
      ProjectionExpression: '#st, #tot, completed, failed',
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

  await deps.ddb.send(
    new UpdateCommand({
      TableName: deps.table,
      Key: jobKey(jobId),
      UpdateExpression: 'SET #st = :complete, completedAt = :now REMOVE gsi1pk, gsi1sk',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':complete': 'complete', ':now': new Date().toISOString() },
    }),
  )
  log('info', 'job finalized', { jobId })
  return true
}
