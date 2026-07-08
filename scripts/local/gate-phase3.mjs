// Phase 3 gate demo: drives the real control API and worker pool through the
// four Phase 3 gates against the local stack. Assumes the stack is up
// (scripts/local/jvm-stack.mjs up or docker compose), the control API is
// serving on API_BASE, and at least one worker is draining the queue.
//
// Usage: API_BASE=http://localhost:8787 GATE_USER=erik GATE_MONTH=2025-06 \
//        node scripts/local/gate-phase3.mjs
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { jobKey, lockKey } from '../../packages/shared/dist/index.js'
import { releaseStaleLocks } from '../../packages/control/dist/src/index.js'
import { assert, sleep } from './harness.mjs'

const API = process.env.API_BASE ?? 'http://localhost:8787'
const USER = process.env.GATE_USER ?? 'erik'
const MONTH = process.env.GATE_MONTH ?? '2025-06'

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: 'us-east-1',
    endpoint: process.env.DYNAMO_ENDPOINT ?? 'http://localhost:8000',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
)
const deps = { ddb, sqs: null, table: process.env.TABLE_NAME ?? 'forked' }
const post = (body) =>
  fetch(`${API}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

// Gate c: a nonexistent username fails cleanly, in voice.
const ghost = await post({ username: 'no_such_user_zzq_12345' })
assert(ghost.code === 'user-not-found', `gate c: nonexistent username -> ${ghost.message}`)

// Gate a (start): a real, capped archive ingests and begins analyzing.
const start = await post({ username: USER, from: MONTH, to: MONTH })
assert(start.ok && start.total > 0, `gate a: ingested ${start.total} games (job ${start.jobId})`)

// Gate b: a concurrent duplicate submission joins the running job.
const dup = await post({ username: USER, from: MONTH, to: MONTH })
assert(dup.joined === true && dup.jobId === start.jobId, 'gate b: duplicate submission joined the running job')

// Gate d: an orphaned lock (ingest killed after acquire, before job creation)
// is released within one janitor sweep; live locks are kept.
await ddb.send(
  new PutCommand({
    TableName: deps.table,
    Item: { ...lockKey('orphan_victim'), jobId: 'never-created', leaseExpiry: Date.now() - 1000 },
  }),
)
const swept = await releaseStaleLocks(deps)
assert(
  swept.some((s) => s.username === 'orphan_victim') && !swept.some((s) => s.username === USER.toLowerCase()),
  'gate d: orphaned lock swept, running job lock kept',
)

// Gate a (finish): the job completes with counters exactly matching game items.
let job
for (let i = 0; i < 90; i++) {
  job = (await ddb.send(new GetCommand({ TableName: deps.table, Key: jobKey(start.jobId) }))).Item
  if (job.status === 'complete' || job.status === 'failed') break
  await sleep(10_000)
}
const games = (
  await ddb.send(
    new QueryCommand({
      TableName: deps.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :g)',
      ExpressionAttributeValues: { ':p': `JOB#${start.jobId}`, ':g': 'GAME#' },
    }),
  )
).Items
const done = games.filter((g) => g.status === 'done').length
const failed = games.filter((g) => g.status === 'failed').length
assert(job.status === 'complete', `gate a: job complete (${job.status})`)
assert(
  job.completed === done && job.failed === failed && job.completed + job.failed === job.total,
  `gate a: counters exact (completed=${job.completed} failed=${job.failed} total=${job.total})`,
)
assert(job.ring.length > 0 && Object.keys(job.agg.opm).length > 0, 'gate a: ring and partial aggregates populated')

console.log('ALL PHASE 3 GATES PASSED')
process.exit(0)
