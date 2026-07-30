// Phase 5 gate demo, the one locally-verifiable gate:
//   (a) the runtime-estimate + monthly-budget routing guard, against the
//       real local queues (calls production ingest directly so the Lambda
//       queue can be enabled without restarting the API server)
// Gates (b) and (c) need the deployed stack; see docs/deploy.md.
//
// Assumes the JVM stack is up and the control API is serving. Run with the
// container worker STOPPED: a draining worker could turn the second ingest's
// games into cache hits before the queue counts are read.
//
// Usage: node scripts/local/gate-phase5.mjs
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { GetQueueAttributesCommand, PurgeQueueCommand } from '@aws-sdk/client-sqs'
import { metricsKey } from '../../packages/shared/dist/index.js'
import { ingest } from '../../packages/control/dist/src/index.js'
import { assert, ddb, deps, ensureQueue, ensureTable, sleep, TABLE } from './harness.mjs'

await ensureTable()

const SCHOLARS = `[Event "Live Chess"]
[White "attacker"]
[Black "gate5_victim"]
[Result "1-0"]
[TimeControl "600"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`

// The Opera Game: 33 plies, past the 30-ply Lambda cutoff configured below.
const OPERA = `[Event "Live Chess"]
[White "morphy_fan"]
[Black "gate5_victim"]
[Result "1-0"]
[TimeControl "600"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`

// Unique node budget per run so every game is a cache miss and actually
// reaches a queue. estimatedNps is derived so the Lambda estimate cutoff
// (600s) lands at exactly 30 plies: scholars (7) fits, opera (33) does not.
const NODE_BUDGET = 500_000 + (Date.now() % 10_000)
const cfg = {
  tableName: TABLE,
  region: 'us-east-1',
  dynamoEndpoint: 'http://localhost:8000',
  sqsEndpoint: 'http://localhost:9324',
  queueName: 'analysis-tasks',
  lambdaQueueName: 'analysis-tasks-lambda',
  gbSecondsBudget: 300_000,
  estimatedNps: Math.round(NODE_BUDGET / 20),
  contactEmail: 'gate@example.com',
  maxGamesPerJob: 500,
  nodeBudget: NODE_BUDGET,
  ratePerDay: 1_000_000,
  port: 0,
}

const month = new Date().toISOString().slice(0, 7)
const setBudgetSpent = (n) =>
  ddb.send(new PutCommand({ TableName: TABLE, Item: { ...metricsKey(month), lambdaGbSeconds: n } }))

const containerUrl = await ensureQueue('analysis-tasks', { visibilitySec: 20, dlqName: 'analysis-tasks-dlq' })
const lambdaUrl = await ensureQueue('analysis-tasks-lambda', { visibilitySec: 60, dlqName: 'analysis-tasks-dlq' })

async function count(url) {
  const out = await deps.sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages'] }),
  )
  return Number(out.Attributes?.ApproximateNumberOfMessages ?? 0)
}
async function purgeBoth() {
  for (const url of [containerUrl, lambdaUrl]) {
    await deps.sqs.send(new PurgeQueueCommand({ QueueUrl: url })).catch(() => {})
  }
  await sleep(300)
}

// ---- Gate (a) part 1: budget exhausted, everything routes to the container.
await purgeBoth()
await setBudgetSpent(999_999)
const over = await ingest(deps, cfg, null, { pgn: `${SCHOLARS}\n\n${OPERA}`, ip: 'gate5' })
assert(over.ok && over.total === 2, `gate a: over-budget ingest created job ${over.jobId}`)
await sleep(500)
assert((await count(containerUrl)) === 2, 'gate a: budget exhausted, both games on the container queue')
assert((await count(lambdaUrl)) === 0, 'gate a: budget exhausted, lambda queue untouched')

// ---- Gate (a) part 2: budget reset, short game goes to Lambda, the long
// estimate stays on the container.
await purgeBoth()
await setBudgetSpent(0)
const split = await ingest(deps, cfg, null, { pgn: `${SCHOLARS}\n\n${OPERA}`, ip: 'gate5' })
assert(split.ok && split.total === 2, `gate a: in-budget ingest created job ${split.jobId}`)
await sleep(500)
assert((await count(lambdaUrl)) === 1, 'gate a: short game routed to the lambda queue')
assert((await count(containerUrl)) === 1, 'gate a: long-estimate game stayed on the container queue')

// Leftovers converge on their own: the janitor requeues these pending games
// through the local config (no LAMBDA_QUEUE_NAME), i.e. onto the container
// queue, where the worker drains them next time it runs.
await purgeBoth()

await setBudgetSpent(0)

console.log('\nphase 5 gate a: PASS (b + c are deploy-day gates, see docs/deploy.md)')
