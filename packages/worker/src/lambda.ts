import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { GameTaskSchema, metricsKey } from '@forked/shared'
import { makeDeps, type Deps } from './db.js'
import { processDlqTask } from './dlq.js'
import { loadConfig } from './env.js'
import { log } from './log.js'
import { processTask } from './process-message.js'
import { Engine } from './uci.js'

// The only SQS event fields the handlers read; not worth @types/aws-lambda.
interface SqsRecord {
  messageId: string
  body: string
  attributes: { ApproximateReceiveCount?: string }
}
export interface SqsEvent {
  Records: SqsRecord[]
}
interface BatchResponse {
  batchItemFailures: { itemIdentifier: string }[]
}

const parseBody = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

// Factory so tests inject fake deps and a fake engine; the module-scope
// export at the bottom is the real Lambda entry point.
export function makeHandlers(deps: Deps, startEngine: () => Promise<Engine> = () => Engine.start()) {
  // Warm-container reuse: one Stockfish process survives across invocations.
  // Nulled on any task failure so the next invocation gets a fresh engine
  // (the process is suspect after a timeout or crash mid-analysis).
  let enginePromise: Promise<Engine> | null = null

  async function handler(event: SqsEvent): Promise<BatchResponse> {
    const started = Date.now()
    const failures: BatchResponse['batchItemFailures'] = []
    try {
      for (const record of event.Records) {
        const parsed = GameTaskSchema.safeParse(parseBody(record.body))
        if (!parsed.success) {
          // Mirror the container poller: garbage is dropped (success deletes
          // the message), never retried.
          log('error', 'unparseable task message, dropping', { body: record.body })
          continue
        }
        const attempts = Number(record.attributes.ApproximateReceiveCount ?? '1')
        try {
          enginePromise ??= startEngine()
          await processTask(deps, await enginePromise, parsed.data, attempts)
        } catch (err) {
          // Failing the item leaves it on the queue for redelivery and, past
          // maxReceiveCount, the DLQ.
          log('error', 'task failed, message will redeliver', { ...parsed.data, attempts, error: String(err) })
          await enginePromise?.then((e) => e.dispose()).catch(() => {})
          enginePromise = null
          failures.push({ itemIdentifier: record.messageId })
        }
      }
    } finally {
      // Awaited on purpose: a fire-and-forget write dies at the freeze that
      // follows the handler's return.
      // ponytail: a hard Lambda timeout kills the sandbox before finally runs,
      // so timed-out invocations go unmetered; the routing estimate keeps
      // those rare, and maxReceiveCount caps a poison game at 5 trips.
      await recordGbSeconds(deps, started)
    }
    return { batchItemFailures: failures }
  }

  async function dlqHandler(event: SqsEvent): Promise<BatchResponse> {
    const failures: BatchResponse['batchItemFailures'] = []
    for (const record of event.Records) {
      const parsed = GameTaskSchema.safeParse(parseBody(record.body))
      if (!parsed.success) {
        log('error', 'unparseable dlq message, dropping', { body: record.body })
        continue
      }
      try {
        await processDlqTask(deps, parsed.data, Number(record.attributes.ApproximateReceiveCount ?? '1'))
      } catch (err) {
        log('error', 'dlq task failed, message will redeliver', { ...parsed.data, error: String(err) })
        failures.push({ itemIdentifier: record.messageId })
      }
    }
    return { batchItemFailures: failures }
  }

  return { handler, dlqHandler }
}

// Feeds the router's monthly budget guard (and the daily metrics rollup).
async function recordGbSeconds(deps: Deps, startedMs: number): Promise<void> {
  const memoryMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? 1769)
  const gbSeconds = ((Date.now() - startedMs) / 1000) * (memoryMb / 1024)
  const day = new Date().toISOString().slice(0, 10)
  const add = (key: { pk: string; sk: string }) =>
    deps.ddb.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: key,
        UpdateExpression: 'ADD lambdaGbSeconds :s',
        ExpressionAttributeValues: { ':s': gbSeconds },
      }),
    )
  const results = await Promise.allSettled([add(metricsKey(day.slice(0, 7))), add(metricsKey(day))])
  for (const r of results) {
    if (r.status === 'rejected') log('warn', 'gb-seconds tick failed', { error: String(r.reason) })
  }
}

export const { handler, dlqHandler } = makeHandlers(makeDeps(loadConfig()))
