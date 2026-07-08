import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs'
import { GameTaskSchema } from '@forked/shared'
import type { Deps } from './db.js'
import { processDlqTask } from './dlq.js'
import { log } from './log.js'
import { processTask } from './process-message.js'
import type { Engine } from './uci.js'

export interface PollerOptions {
  queueUrl: string
  visibilitySec: number
  heartbeatSec: number
  mode: 'worker' | 'dlq'
}

export interface Poller {
  // receipt handle of the in-flight message, for shutdown requeue
  current: { receiptHandle: string } | null
  run(): Promise<void>
}

// Long-polls the queue, one message at a time. While a game is being
// analyzed, the message lease is extended with ChangeMessageVisibility every
// heartbeatSec (the heartbeat), so a game longer than the base visibility
// timeout is never redelivered mid-analysis. The message is deleted only
// after the completion transaction has succeeded.
export function makePoller(deps: Deps, engine: Engine | null, opts: PollerOptions, signal: AbortSignal): Poller {
  const poller: Poller = {
    current: null,
    async run() {
      while (!signal.aborted) {
        let out
        try {
          out = await deps.sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: opts.queueUrl,
              MaxNumberOfMessages: 1,
              WaitTimeSeconds: 20,
              MessageSystemAttributeNames: ['ApproximateReceiveCount'],
            }),
            { abortSignal: signal },
          )
        } catch (err) {
          if (signal.aborted) break
          log('error', 'receive failed', { error: String(err) })
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        const msg = out.Messages?.[0]
        if (!msg?.Body || !msg.ReceiptHandle) continue

        const parsed = GameTaskSchema.safeParse(JSON.parse(msg.Body))
        if (!parsed.success) {
          log('error', 'unparseable task message, deleting', { body: msg.Body })
          await deps.sqs.send(
            new DeleteMessageCommand({ QueueUrl: opts.queueUrl, ReceiptHandle: msg.ReceiptHandle }),
          )
          continue
        }
        const attempts = Number(msg.Attributes?.ApproximateReceiveCount ?? '1')

        poller.current = { receiptHandle: msg.ReceiptHandle }
        const heartbeat = setInterval(() => {
          deps.sqs
            .send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: opts.queueUrl,
                ReceiptHandle: msg.ReceiptHandle,
                VisibilityTimeout: opts.visibilitySec,
              }),
            )
            .catch((err) => log('warn', 'heartbeat failed', { ...parsed.data, error: String(err) }))
        }, opts.heartbeatSec * 1000)

        try {
          if (opts.mode === 'dlq') await processDlqTask(deps, parsed.data, attempts)
          else await processTask(deps, engine!, parsed.data, attempts)
          await deps.sqs.send(
            new DeleteMessageCommand({ QueueUrl: opts.queueUrl, ReceiptHandle: msg.ReceiptHandle }),
          )
        } catch (err) {
          // No delete: the message redelivers and, past maxReceiveCount,
          // dead-letters. The idempotent completion transaction makes any
          // duplicate work harmless.
          log('error', 'task failed, message will redeliver', { ...parsed.data, attempts, error: String(err) })
        } finally {
          clearInterval(heartbeat)
          poller.current = null
        }
      }
    },
  }
  return poller
}

// Graceful shutdown: called when the SIGTERM grace window expires with a
// game still in flight; makes the message instantly available to another
// worker.
export async function requeueNow(deps: Deps, queueUrl: string, receiptHandle: string): Promise<void> {
  await deps.sqs.send(
    new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: 0 }),
  )
}
