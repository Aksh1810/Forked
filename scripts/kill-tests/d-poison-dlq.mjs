// Gate (d): a poison game (corrupted move list, fails every attempt) routes
// through the DLQ consumer, is marked failed via the same completion
// transaction, and the job completes with a failed count of exactly one.
import { assert, createJob, ensureQueue, ensureTable, listGames, sh, waitForJob } from '../local/harness.mjs'
import { generateGames } from '../local/gen-games.mjs'

await ensureTable()
await ensureQueue('test-poison', { visibilitySec: 3, dlqName: 'test-poison-dlq', maxReceive: 5 })

const workerCid = sh(
  `docker compose run -d --rm -e QUEUE_NAME=test-poison -e VISIBILITY_SEC=3 -e HEARTBEAT_SEC=60 worker`,
)
const dlqCid = sh(
  `docker compose run -d --rm -e WORKER_MODE=dlq -e DLQ_NAME=test-poison-dlq dlq-consumer`,
)
console.log(`worker ${workerCid}, dlq consumer ${dlqCid}`)

try {
  const { jobId } = await createJob(generateGames(3, { seed: 404 }), {
    nodeBudget: 120_000,
    queue: 'test-poison',
    corrupt: [1], // game g1 gets an illegal move list: fails on every attempt
  })
  const job = await waitForJob(jobId, 240_000)
  assert(job.status === 'complete', `job completed despite the poison game (status=${job.status})`)
  assert(job.completed === 2, `completed is exactly 2 (got ${job.completed})`)
  assert(job.failed === 1, `failed is exactly 1 (got ${job.failed})`)

  const games = await listGames(jobId)
  const poison = games.find((g) => g.gameId === 'g1')
  assert(poison.status === 'failed', `poison game item is failed (got ${poison.status})`)
  assert(String(poison.error).includes('poison'), `poison error message recorded (${poison.error})`)
  assert(poison.attempts >= 5, `poison game exhausted maxReceiveCount (attempts=${poison.attempts})`)
  console.log('GATE D PASSED')
} finally {
  sh(`docker rm -f ${workerCid} ${dlqCid}`)
}
