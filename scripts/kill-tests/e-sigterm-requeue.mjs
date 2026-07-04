// Gate (e): SIGTERM mid-game requeues the in-flight message instantly (grace
// window deliberately shorter than the game) and another worker finishes it,
// with exactly-once accounting.
import { assert, createJob, ensureQueue, ensureTable, sh, sleep, waitForJob } from '../local/harness.mjs'
import { generateGames } from '../local/gen-games.mjs'

await ensureTable()
await ensureQueue('test-sigterm', { visibilitySec: 120, dlqName: 'test-sigterm-dlq' })

const workerA = sh(
  `docker compose run -d -e QUEUE_NAME=test-sigterm -e VISIBILITY_SEC=120 -e HEARTBEAT_SEC=30 -e GRACE_MS=3000 worker`,
)
console.log(`worker A ${workerA}`)

let workerB = null
try {
  const { jobId } = await createJob(generateGames(1, { seed: 505, minPlies: 26 }), {
    nodeBudget: 900_000,
    queue: 'test-sigterm',
  })

  // wait until worker A is actually mid-game
  for (let i = 0; i < 30; i++) {
    if (sh(`docker logs ${workerA} 2>&1`).includes('"processing game"')) break
    await sleep(1000)
  }
  assert(sh(`docker logs ${workerA} 2>&1`).includes('"processing game"'), 'worker A is mid-game')

  sh(`docker stop -t 40 ${workerA}`) // SIGTERM; our 3s grace expires long before the game could finish
  const logsA = sh(`docker logs ${workerA} 2>&1`)
  assert(logsA.includes('grace expired'), 'worker A requeued the in-flight message on SIGTERM')
  assert(!logsA.includes('"game completed"'), 'worker A never completed the game')

  workerB = sh(
    `docker compose run -d --rm -e QUEUE_NAME=test-sigterm -e VISIBILITY_SEC=120 -e HEARTBEAT_SEC=30 worker`,
  )
  console.log(`worker B ${workerB}`)
  const job = await waitForJob(jobId, 180_000)
  assert(job.status === 'complete' && job.completed === 1, 'worker B finished the game, counted exactly once')
  assert(sh(`docker logs ${workerB} 2>&1`).includes('"game completed"'), 'worker B did the completion')
  console.log('GATE E PASSED')
} finally {
  sh(`docker rm -f ${workerA}`)
  if (workerB) sh(`docker rm -f ${workerB}`)
}
