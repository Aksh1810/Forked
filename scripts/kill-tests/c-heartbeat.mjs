// Gate (c): a game running longer than the base visibility timeout is never
// double-processed, proving the ChangeMessageVisibility heartbeat. A
// dedicated queue gets a 6-second visibility timeout while the single game
// takes roughly 15 seconds at a 600k node budget; the worker heartbeats
// every 2 seconds.
import { assert, createJob, ensureQueue, ensureTable, sh, waitForJob } from '../local/harness.mjs'
import { generateGames } from '../local/gen-games.mjs'

await ensureTable()
await ensureQueue('test-heartbeat', { visibilitySec: 6, dlqName: 'test-heartbeat-dlq' })

const cid = sh(
  `docker compose run -d --rm -e QUEUE_NAME=test-heartbeat -e VISIBILITY_SEC=6 -e HEARTBEAT_SEC=2 worker`,
)
console.log(`one-off worker ${cid}`)

try {
  const { jobId } = await createJob(generateGames(1, { seed: 303, minPlies: 26 }), {
    nodeBudget: 600_000,
    queue: 'test-heartbeat',
  })
  const job = await waitForJob(jobId, 180_000)
  assert(job.status === 'complete' && job.completed === 1, 'long game completed exactly once in counters')

  const logs = sh(`docker logs ${cid} 2>&1`)
  const processed = logs.split('\n').filter((l) => l.includes('"processing game"')).length
  assert(processed === 1, `game was processed exactly once, never redelivered (got ${processed} starts)`)
  assert(!logs.includes('duplicate delivery'), 'no duplicate delivery was ever observed')
  console.log('GATE C PASSED')
} finally {
  sh(`docker rm -f ${cid}`)
}
