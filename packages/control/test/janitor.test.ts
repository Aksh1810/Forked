import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { expect, test } from 'vitest'
import { runJanitor } from '../src/janitor.js'
import { fakeDeps, byName, type Call } from './fake-deps.js'

const NOW = 1_800_000_000_000
const CFG = { queueName: 'q', lambdaQueueName: undefined, gbSecondsBudget: 300_000, estimatedNps: 350_000 }

const game = (gameId: string, status: string) => ({ pk: 'JOB#stuck', sk: `GAME#${gameId}`, gameId, status, cacheKey: 'k' })

// A job the workers left behind: 3 done, 1 failed, 1 stuck pending, but the
// job counters drifted to completed=2 failed=0.
function overdueScenario(respondExtra?: (call: Call) => unknown) {
  return fakeDeps((call) => {
    if (call.name === 'QueryCommand' && call.input.IndexName === 'gsi1') {
      return { Items: [{ jobId: 'stuck' }] }
    }
    if (call.name === 'QueryCommand') {
      return {
        Items: [
          game('a', 'done'),
          game('b', 'done'),
          game('c', 'done'),
          game('d', 'failed'),
          game('e', 'pending'),
        ],
      }
    }
    if (call.name === 'GetQueueUrlCommand') return { QueueUrl: 'http://q' }
    if (call.name === 'ScanCommand') return { Items: [] }
    return respondExtra?.(call) ?? {}
  })
}

test('janitor recounts from game items, repairs counters, requeues stuck pending', async () => {
  const { deps, calls } = overdueScenario()
  const report = await runJanitor(deps, CFG, NOW)

  expect(report.jobsScanned).toBe(1)
  expect(report.jobsRepaired).toBe(1)
  expect(report.gamesRequeued).toBe(1)
  expect(report.jobsFinalized).toBe(0) // one game still pending

  const repair = byName(calls, 'UpdateCommand').find((c) => c.input.Key.sk === 'META')!
  expect(repair.input.ExpressionAttributeValues[':d']).toBe(3) // done recounted
  expect(repair.input.ExpressionAttributeValues[':f']).toBe(1) // failed recounted
  expect(repair.input.ConditionExpression).toContain('completed <> :d OR failed <> :f')

  const requeue = byName(calls, 'SendMessageBatchCommand')[0]
  expect(requeue.input.Entries).toHaveLength(1)
  expect(JSON.parse(requeue.input.Entries[0].MessageBody)).toEqual({ jobId: 'stuck', gameId: 'e' })
})

test('counters already correct: the repair write no-ops, nothing requeued', async () => {
  const { deps, calls } = fakeDeps((call) => {
    if (call.name === 'QueryCommand' && call.input.IndexName === 'gsi1') return { Items: [{ jobId: 'ok' }] }
    if (call.name === 'QueryCommand') return { Items: [game('a', 'done'), game('b', 'failed')] }
    if (call.name === 'GetQueueUrlCommand') return { QueueUrl: 'http://q' }
    if (call.name === 'ScanCommand') return { Items: [] }
    // finalize path: job not fully settled (total 3) so tryFinalize bails early
    if (call.name === 'GetCommand') return { Item: { status: 'analyzing', total: 3, completed: 1, failed: 1 } }
    if (call.name === 'UpdateCommand') throw new ConditionalCheckFailedException({ $metadata: {}, message: 'x' })
    return {}
  })
  const report = await runJanitor(deps, CFG, NOW)
  expect(report.jobsRepaired).toBe(0) // conditional repair failed -> counted as no-op
  expect(report.gamesRequeued).toBe(0)
  expect(byName(calls, 'SendMessageBatchCommand')).toHaveLength(0)
})

test('no overdue jobs: no queue lookup, only the lock sweep runs', async () => {
  const { deps, calls } = fakeDeps((call) => {
    if (call.name === 'QueryCommand') return { Items: [] }
    if (call.name === 'ScanCommand') return { Items: [] }
    return {}
  })
  const report = await runJanitor(deps, CFG, NOW)
  expect(report.jobsScanned).toBe(0)
  expect(byName(calls, 'GetQueueUrlCommand')).toHaveLength(0) // resolveQueueUrl skipped
  expect(byName(calls, 'ScanCommand')).toHaveLength(1) // lock sweep still ran
})
