// Gate (a): a 20-game job on 4 workers, one worker killed mid-game with
// docker kill; the game is retried, counters are exact, the job completes.
// Prereq: docker compose up -d --build --scale worker=4 with VISIBILITY_SEC=20
// HEARTBEAT_SEC=8 (see run-all.mjs), table created.
import { assert, createJob, ensureTable, listGames, sh, sleep, waitForJob } from '../local/harness.mjs'
import { generateGames } from '../local/gen-games.mjs'

await ensureTable()
const { jobId, enqueued } = await createJob(generateGames(20, { seed: 101 }), { nodeBudget: 150_000 })
console.log(`job ${jobId}, ${enqueued} messages enqueued`)

// let analysis get going, then kill one worker mid-game
await sleep(8000)
const victim = sh(`docker ps --filter name=worker --format '{{.Names}}'`).split('\n')[0]
assert(!!victim, `found a worker container to kill (${victim})`)
sh(`docker kill ${victim}`)
console.log(`killed ${victim}`)

const job = await waitForJob(jobId, 240_000)
assert(job.status === 'complete', `job completed (status=${job.status})`)
assert(job.completed === 20, `completed counter is exactly 20 (got ${job.completed})`)
assert(job.failed === 0, `failed counter is exactly 0 (got ${job.failed})`)

const games = await listGames(jobId)
const done = games.filter((g) => g.status === 'done').length
assert(done === 20, `all 20 game items are done (got ${done})`)
assert(
  job.completed === done && job.failed === 0,
  'job counters exactly match a recount from game items (the source of truth)',
)
console.log('GATE A PASSED')
