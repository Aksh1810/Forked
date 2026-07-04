// Gate (b): a completed game's message forcibly delivered a second time; the
// completion transaction no-ops and the counter is unchanged. Part 1 drives
// the transaction directly (no workers needed); part 2, when WITH_WORKERS=1,
// re-sends a real SQS message for an already-done game.
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import {
  assert,
  createJob,
  deps,
  ensureQueue,
  ensureTable,
  getJob,
  listGames,
  queueUrl,
  sleep,
  sqs,
  waitForJob,
} from '../local/harness.mjs'
import { generateGames } from '../local/gen-games.mjs'
import { executeCompletion } from '../../packages/worker/dist/index.js'

await ensureTable()

// Part 1: the transaction itself is idempotent. Uses a queue no worker
// listens on, so nothing races the direct completion calls below.
await ensureQueue('test-direct', { visibilitySec: 30 })
const { jobId } = await createJob(generateGames(1, { seed: 202 }), { queue: 'test-direct' })
// settle the game directly, twice, with the same outcome
const outcome = {
  kind: 'done',
  attempts: 1,
  ringEntry: { gameId: 'g0', accuracy: 77.7, finishedAt: new Date().toISOString() },
  contribution: {
    family: 'Test',
    accuracy: 77.7,
    moves: 10,
    blunders: 1,
    phaseMoves: { middlegame: 10 },
    phaseBlunders: { middlegame: 1 },
  },
}
const first = await executeCompletion(deps, jobId, 'g0', outcome)
const second = await executeCompletion(deps, jobId, 'g0', outcome)
assert(first === 'applied', `first completion applied (got ${first})`)
assert(second === 'noop', `second completion no-ops (got ${second})`)
let job = await getJob(jobId)
assert(job.completed === 1, `completed counter is exactly 1 after duplicate (got ${job.completed})`)
assert(job.ring.length === 1, `ring holds one entry (got ${job.ring.length})`)
assert(job.agg.opm.Test === 10, 'aggregates counted once')

// Part 2: full path with a forced duplicate SQS delivery.
if (process.env.WITH_WORKERS === '1') {
  const run2 = await createJob(generateGames(2, { seed: 203 }), { nodeBudget: 120_000 })
  job = await waitForJob(run2.jobId)
  assert(job.completed === 2, `worker job completed both games (got ${job.completed})`)
  const url = await queueUrl('analysis-tasks')
  await sqs.send(
    new SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify({ jobId: run2.jobId, gameId: 'g0' }) }),
  )
  await sleep(6000)
  job = await getJob(run2.jobId)
  assert(job.completed === 2, `counter unchanged after forced duplicate delivery (got ${job.completed})`)
  const games = await listGames(run2.jobId)
  assert(games.every((g) => g.status === 'done'), 'all game items still done')
}
console.log('GATE B PASSED')
