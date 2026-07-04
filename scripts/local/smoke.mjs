// End-to-end smoke against the local stack: creates a small job and waits
// for workers (container or local `node packages/worker/dist/main.js`) to
// drain it, then checks counters against the game items.
import { assert, createJob, ensureTable, listGames, waitForJob } from './harness.mjs'
import { generateGames } from './gen-games.mjs'

await ensureTable()
const games = Number(process.env.SMOKE_GAMES ?? 4)
const { jobId, enqueued } = await createJob(generateGames(games, { seed: Number(process.env.SMOKE_SEED ?? 7) }), {
  nodeBudget: Number(process.env.SMOKE_BUDGET ?? 60_000),
})
console.log(`job ${jobId}: ${enqueued} enqueued`)
const job = await waitForJob(jobId, 300_000)
assert(job.status === 'complete', `job complete (${job.status})`)
const items = await listGames(jobId)
const done = items.filter((g) => g.status === 'done').length
assert(job.completed === done && job.completed + job.failed === games, 'counters exactly match game items')
console.log(`ring: ${job.ring.length} entries, agg families: ${Object.keys(job.agg.opm).join(', ')}`)
console.log('SMOKE PASSED')
