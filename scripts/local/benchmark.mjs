// Phase 6 scaling benchmark: the IDENTICAL 100-game job at 1, 2, 4, and 8
// workers against the local stack, walltime per fleet size for the README.
// The cache is defeated by bumping nodeBudget by 1 per run: the work is the
// same to within a few engine nodes, but every cache key is fresh.
//
// Assumes the JVM stack is up (scripts/local/jvm-stack.mjs up) and the worker
// package is built. The control API is not involved; jobs are created through
// the same production ingest path the harness wraps.
//
// Usage: node scripts/local/benchmark.mjs
//        BENCH_GAMES=20 BENCH_FLEETS=1,2 node scripts/local/benchmark.mjs  (quick check)
import { spawn } from 'node:child_process'
import { PurgeQueueCommand } from '@aws-sdk/client-sqs'
import { generateGames } from './gen-games.mjs'
import { createJob, deps, ensureQueue, ensureTable, queueUrl, sleep, waitForJob } from './harness.mjs'

const GAMES = Number(process.env.BENCH_GAMES ?? 100)
const BASE_BUDGET = Number(process.env.BENCH_NODE_BUDGET ?? 150_000)
const FLEETS = (process.env.BENCH_FLEETS ?? '1,2,4,8').split(',').map(Number)

await ensureTable()
await ensureQueue('analysis-tasks', { dlqName: 'analysis-tasks-dlq' })
const url = await queueUrl('analysis-tasks')

// Fresh seed per invocation: a rerun must not hit the cache entries a prior
// benchmark (or its smoke test) left behind. The SAME games serve all fleet
// sizes within one run, which is the comparison that matters.
const seed = Number(process.env.BENCH_SEED ?? Date.now() % 1_000_000)
const pgns = generateGames(GAMES, { seed, username: 'bench', minPlies: 40 })

function startWorker() {
  return spawn('node', ['packages/worker/dist/main.js'], {
    env: {
      ...process.env,
      TABLE_NAME: 'forked',
      QUEUE_NAME: 'analysis-tasks',
      DLQ_NAME: 'analysis-tasks-dlq',
      DYNAMO_ENDPOINT: 'http://localhost:8000',
      SQS_ENDPOINT: 'http://localhost:9324',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
      // The local elasticmq queue defaults to a 20s visibility window, so
      // heartbeat well inside it.
      VISIBILITY_SEC: '60',
      HEARTBEAT_SEC: '10',
    },
    stdio: 'ignore',
  })
}

const results = []
for (const [i, fleet] of FLEETS.entries()) {
  await deps.sqs.send(new PurgeQueueCommand({ QueueUrl: url })).catch(() => {})
  const workers = Array.from({ length: fleet }, startWorker)
  try {
    await sleep(2000) // engines boot
    const started = Date.now()
    const { jobId, enqueued } = await createJob(pgns, {
      nodeBudget: BASE_BUDGET + i, // defeat the cache, keep the work identical
      username: 'bench',
    })
    if (enqueued !== GAMES) throw new Error(`expected ${GAMES} fresh games, enqueued ${enqueued}`)
    const job = await waitForJob(jobId, 2 * 3600_000)
    const walltimeSec = Math.round((Date.now() - started) / 1000)
    if (job.status !== 'complete' || job.failed > 0) {
      throw new Error(`bench run at fleet ${fleet} did not complete cleanly: ${JSON.stringify(job)}`)
    }
    results.push({ fleet, walltimeSec })
    console.log(`${fleet} worker(s): ${walltimeSec}s`)
  } finally {
    // An orphaned worker would silently join the next fleet and corrupt it.
    for (const w of workers) w.kill('SIGKILL')
  }
}

const t1 = results[0].walltimeSec
console.log(`\n${GAMES} games, nodeBudget ~${BASE_BUDGET}, host: ${process.arch}`)
console.log('| Workers | Walltime | Speedup |')
console.log('|---|---|---|')
for (const r of results) {
  console.log(`| ${r.fleet} | ${Math.floor(r.walltimeSec / 60)}m ${r.walltimeSec % 60}s | ${(t1 / r.walltimeSec).toFixed(2)}x |`)
}
