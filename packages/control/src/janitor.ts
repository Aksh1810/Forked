import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import { STATUS_GSI, jobKey } from '@forked/shared'
import { finalizeJob, log, tryFinalize, type Deps } from '@forked/worker'
import { makeRouter, type PickQueue, type RouterCfg } from './route.js'
import { releaseStaleLocks, type SweptLock } from './sweep.js'

export interface JanitorReport {
  jobsScanned: number
  jobsRepaired: number
  gamesRequeued: number
  jobsFinalized: number
  locksReleased: SweptLock[]
}

// THE JANITOR. A control loop, the same pattern Kubernetes is built on: it
// does not trust the job counters, it reconciles them against the game items,
// which are the source of truth. On each sweep it finds jobs stuck in
// analyzing past their deadline (via the sparse status GSI), recounts from the
// actual game items, repairs drifted counters, requeues games stuck in
// pending (idempotent accounting makes the duplicate work harmless), finalizes
// any job whose recount shows it is fully settled, and releases stale locks.
// This is the system's convergence guarantee: whatever breaks, the next sweep
// pulls the job back toward correctness.
export async function runJanitor(
  deps: Deps,
  cfg: RouterCfg,
  now = Date.now(),
): Promise<JanitorReport> {
  const report: JanitorReport = {
    jobsScanned: 0,
    jobsRepaired: 0,
    gamesRequeued: 0,
    jobsFinalized: 0,
    locksReleased: [],
  }
  const nowIso = new Date(now).toISOString()

  // Sparse GSI: the gsi1pk attribute lives on a job only until the finalizer's
  // complete write removes it, so this reads overdue jobs that are still
  // analyzing OR stuck in finalizing (a finalizer that won its claim then
  // crashed before completing), and nothing else.
  let start: Record<string, unknown> | undefined
  const overdue: { jobId: string; status: string; username: string | null }[] = []
  do {
    const page = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.table,
        IndexName: STATUS_GSI,
        KeyConditionExpression: 'gsi1pk = :s AND gsi1sk < :now',
        ExpressionAttributeValues: { ':s': 'STATUS#analyzing', ':now': nowIso },
        ExclusiveStartKey: start,
      }),
    )
    for (const j of page.Items ?? []) {
      overdue.push({
        jobId: j.jobId as string,
        status: j.status as string,
        username: typeof j.username === 'string' ? j.username : null,
      })
    }
    start = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (start)

  const pick = overdue.length ? await makeRouter(deps, cfg) : null
  for (const job of overdue) {
    report.jobsScanned += 1
    if (job.status === 'finalizing') {
      // The previous finalizer crashed after claiming. Re-drive it; finalizeJob
      // is idempotent, so this is safe even against a slow live finalizer.
      await finalizeJob(deps, job.jobId, job.username)
      report.jobsFinalized += 1
      log('warn', 'janitor re-drove a stuck finalizing job', { jobId: job.jobId })
      continue
    }
    await reconcileJob(deps, job.jobId, pick as PickQueue, report)
  }

  report.locksReleased = await releaseStaleLocks(deps, now)
  if (report.jobsRepaired || report.gamesRequeued || report.jobsFinalized || report.locksReleased.length) {
    log('warn', 'janitor repaired stuck state', { ...report, locksReleased: report.locksReleased.length })
  }
  return report
}

async function reconcileJob(
  deps: Deps,
  jobId: string,
  pick: PickQueue,
  report: JanitorReport,
): Promise<void> {
  const games: Record<string, unknown>[] = []
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
    games.push(...((page.Items ?? []) as Record<string, unknown>[]))
    start = page.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (start)

  const done = games.filter((g) => g.status === 'done').length
  const failed = games.filter((g) => g.status === 'failed').length
  const pending = games.filter((g) => g.status === 'pending')

  // Repair drifted counters from the source of truth. Guarded so it only fires
  // on an actual mismatch (avoids a needless write every sweep).
  try {
    await deps.ddb.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: jobKey(jobId),
        ConditionExpression:
          '#st = :analyzing AND (completed <> :d OR failed <> :f)',
        UpdateExpression: 'SET completed = :d, failed = :f',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':analyzing': 'analyzing', ':d': done, ':f': failed },
      }),
    )
    report.jobsRepaired += 1
    log('warn', 'janitor repaired counters', { jobId, done, failed })
  } catch {
    // ConditionalCheckFailed: counters already correct or job no longer
    // analyzing. Either way nothing to repair.
  }

  // Requeue games stuck in pending, routed per game exactly like ingest. The
  // completion transaction is idempotent, so duplicate work is harmless.
  const toSend = new Map<string, string[]>() // queue URL -> game ids
  for (const g of pending) {
    const url = pick(((g.uciMoves as string[] | undefined) ?? []).length, Number(g.nodeBudget ?? 0))
    toSend.set(url, [...(toSend.get(url) ?? []), g.gameId as string])
  }
  for (const [queueUrl, gameIds] of toSend) {
    for (let i = 0; i < gameIds.length; i += 10) {
      const batch = gameIds.slice(i, i + 10)
      await deps.sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: batch.map((gameId, j) => ({
            Id: String(j),
            MessageBody: JSON.stringify({ jobId, gameId }),
          })),
        }),
      )
      report.gamesRequeued += batch.length
    }
  }

  // Fully settled per the recount: finalize now rather than waiting for a
  // completion that already happened.
  if (pending.length === 0 && (await tryFinalize(deps, jobId))) report.jobsFinalized += 1
}
