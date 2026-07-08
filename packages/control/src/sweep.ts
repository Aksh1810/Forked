import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { jobKey } from '@forked/shared'
import { log, type Deps } from '@forked/worker'

export interface SweptLock {
  username: string
  jobId: string | null
  reason: 'expired' | 'job-terminal'
}

// The janitor's lock sweep: releases any per-username lock whose lease has
// expired or whose job is terminal. An ingest killed between acquiring the
// lock and creating the job leaves exactly such a lock, and this releases it
// within one sweep of the lease expiring. Phase 4's janitor cron calls this
// alongside the job recount.
export async function releaseStaleLocks(deps: Deps, now = Date.now()): Promise<SweptLock[]> {
  const released: SweptLock[] = []
  let start: Record<string, unknown> | undefined
  do {
    // ponytail: a filtered table Scan; locks are few and sweeps run every 10
    // minutes. A sparse lock GSI if lock volume ever matters.
    const page = await deps.ddb.send(
      new ScanCommand({
        TableName: deps.table,
        FilterExpression: 'begins_with(pk, :l)',
        ExpressionAttributeValues: { ':l': 'LOCK#' },
        ExclusiveStartKey: start,
      }),
    )
    for (const lock of page.Items ?? []) {
      const jobId = typeof lock.jobId === 'string' ? lock.jobId : null
      const job = jobId
        ? (
            await deps.ddb.send(
              new GetCommand({
                TableName: deps.table,
                Key: jobKey(jobId),
                ProjectionExpression: '#st',
                ExpressionAttributeNames: { '#st': 'status' },
              }),
            )
          ).Item
        : null
      const terminal = job?.status === 'complete' || job?.status === 'failed'
      const expired = typeof lock.leaseExpiry === 'number' && lock.leaseExpiry < now
      if (!terminal && !expired) continue
      try {
        // Conditioned on the exact lease seen, so a lock re-acquired between
        // the scan and this delete survives.
        await deps.ddb.send(
          new DeleteCommand({
            TableName: deps.table,
            Key: { pk: lock.pk, sk: lock.sk },
            ConditionExpression: 'leaseExpiry = :e',
            ExpressionAttributeValues: { ':e': lock.leaseExpiry },
          }),
        )
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) continue
        throw e
      }
      const entry: SweptLock = {
        username: String(lock.pk).slice('LOCK#'.length),
        jobId,
        reason: terminal ? 'job-terminal' : 'expired',
      }
      released.push(entry)
      log('info', 'released stale lock', { ...entry })
    }
    start = page.LastEvaluatedKey
  } while (start)
  return released
}
