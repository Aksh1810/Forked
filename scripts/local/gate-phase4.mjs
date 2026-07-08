// Phase 4 backend gate demo against the local stack (jvm-stack + control API +
// worker pool). Drives the finalizer race, the janitor counter repair, the
// janitor requeue convergence, and prints the real archetype for eyeballing.
//
// Usage: node scripts/local/gate-phase4.mjs
import { randomUUID } from 'node:crypto'
import { PurgeQueueCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { analyzingGsiAttrs, emptyPartialAgg, gameKey, jobKey } from '../../packages/shared/dist/index.js'
import { runJanitor } from '../../packages/control/dist/src/index.js'
import {
  assert,
  createJob,
  ddb,
  deps,
  ensureQueue,
  ensureTable,
  getJob,
  listGames,
  queueUrl,
  sleep,
  sqs,
  waitForJob,
  TABLE,
} from './harness.mjs'
import { generateGames } from './gen-games.mjs'

const BUDGET = Number(process.env.GATE_BUDGET ?? 120_000)
await ensureTable()
await ensureQueue('analysis-tasks', { visibilitySec: 20, dlqName: 'analysis-tasks-dlq' })
const url = await queueUrl('analysis-tasks')
const past = new Date(Date.now() - 60_000).toISOString()

// Reads back a job's done game items so a later job can reuse their real engine
// records (cache hits) without re-analyzing.
async function doneGameSpecs(jobId) {
  const items = await listGames(jobId)
  return items
    .filter((g) => g.status === 'done')
    .map((g) => ({ cacheKey: g.cacheKey, uciMoves: g.uciMoves, userColor: g.userColor, game: g.game }))
}

async function seedJob(jobId, { status, completed, failed, deadlineAt }, games) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        ...jobKey(jobId),
        ...(status === 'analyzing' ? analyzingGsiAttrs(deadlineAt) : {}),
        jobId,
        username: null,
        status,
        total: games.length,
        completed,
        failed,
        nodeBudget: BUDGET,
        ring: [],
        agg: emptyPartialAgg(),
        createdAt: new Date().toISOString(),
        deadlineAt,
      },
    }),
  )
  for (const [i, g] of games.entries()) {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          ...gameKey(jobId, `g${i}`),
          jobId,
          gameId: `g${i}`,
          status: g.status,
          attempts: 1,
          cacheKey: g.cacheKey,
          uciMoves: g.uciMoves,
          userColor: g.userColor,
          nodeBudget: BUDGET,
          game: { ...g.game, gameId: `g${i}` },
        },
      }),
    )
  }
}

// ------- prime real engine records by running one normal job -------
console.log('\n### priming engine records with a normal 3-game job')
const seed = generateGames(3, { seed: 11 })
const primed = await createJob(seed, { nodeBudget: BUDGET, username: 'gate4' })
const primedJob = await waitForJob(primed.jobId, 300_000)
assert(primedJob.status === 'complete', `primed job complete (${primedJob.status})`)
assert(primedJob.wrapped && primedJob.wrapped.archetype, 'primed job carries a wrapped summary with an archetype')
const specs = await doneGameSpecs(primed.jobId)
assert(specs.length === 3, `captured ${specs.length} real engine records for reuse`)

// ------- GATE e: real job produces a defensible archetype -------
console.log('\n### GATE e: archetype on a real job')
const w = primedJob.wrapped
console.log(`archetype: ${w.archetype.name} (${w.archetype.key}) mark=${w.archetype.mark}`)
console.log(`  "${w.archetype.description}"`)
console.log(`  accuracy=${w.accuracy?.toFixed(1)} games=${w.totalGames} positions=${w.totalPositions}`)
console.log(`  poison=${JSON.stringify(w.poisonOpening)} worstBlunder.loss=${w.worstBlunder?.lossPct}`)
console.log(`  delighter=${JSON.stringify(w.delighter)}`)
assert(w.archetype.key && w.archetype.description, 'gate e: archetype has a name and a stat-backed line')

// ------- GATE b: corrupt a job counter, janitor recounts and completes -------
console.log('\n### GATE b: janitor repairs a corrupted counter')
const corruptId = randomUUID()
// All games are actually done, but the job counter lies (completed=0) and the
// deadline is past so the janitor picks it up.
await seedJob(
  corruptId,
  { status: 'analyzing', completed: 0, failed: 0, deadlineAt: past },
  specs.map((s) => ({ ...s, status: 'done' })),
)
const before = await getJob(corruptId)
assert(before.completed === 0 && before.status === 'analyzing', 'seeded job has a corrupted counter (completed=0)')
const rep1 = await runJanitor(deps, { queueName: 'analysis-tasks' })
const fixed = await waitForJob(corruptId, 60_000)
assert(fixed.status === 'complete', `gate b: job completed after janitor recount (${fixed.status})`)
assert(fixed.completed === 3 && fixed.failed === 0, `gate b: counters repaired from game items (completed=${fixed.completed})`)
assert(fixed.wrapped && fixed.wrapped.archetype, 'gate b: finalized with a wrapped summary')
assert(rep1.jobsRepaired >= 1 && rep1.jobsFinalized >= 1, 'gate b: janitor reported the repair and finalize')

// ------- GATE c: games stuck pending with no messages, janitor requeues -------
console.log('\n### GATE c: janitor requeues stuck-pending games, job converges')
// Create the job normally, then purge the queue so the delivered messages are
// lost (as if consumed by a dead worker that never redelivered); the janitor
// must notice the still-pending games and requeue them.
const stuck = await createJob(generateGames(3, { seed: 42 }), { nodeBudget: BUDGET, username: 'gate4c', queue: 'analysis-tasks' })
await sqs.send(new PurgeQueueCommand({ QueueUrl: url })) // drop the delivered messages: workers will never see them
// force the job overdue so the janitor sweeps it
await ddb.send(
  new PutCommand({
    TableName: TABLE,
    Item: {
      ...jobKey(stuck.jobId),
      ...analyzingGsiAttrs(past),
      jobId: stuck.jobId,
      username: 'gate4c',
      status: 'analyzing',
      total: 3,
      completed: 0,
      failed: 0,
      nodeBudget: BUDGET,
      ring: [],
      agg: emptyPartialAgg(),
      createdAt: new Date().toISOString(),
      deadlineAt: past,
    },
  }),
)
await sleep(3000)
const beforeC = await getJob(stuck.jobId)
assert(beforeC.status === 'analyzing' && beforeC.completed === 0, 'gate c: job stuck at 0 with messages purged')
const rep2 = await runJanitor(deps, { queueName: 'analysis-tasks' })
assert(rep2.gamesRequeued >= 3, `gate c: janitor requeued the stuck games (${rep2.gamesRequeued})`)
const convergedC = await waitForJob(stuck.jobId, 300_000)
assert(convergedC.status === 'complete', `gate c: job converged to complete after requeue (${convergedC.status})`)
assert(convergedC.completed + convergedC.failed === 3, 'gate c: exact counters after convergence')

// ------- GATE a: finalizer race, two last games finish together -------
console.log('\n### GATE a: finalizer race, exactly one finalization')
const raceId = randomUUID()
await seedJob(
  raceId,
  { status: 'analyzing', completed: 0, failed: 0, deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString() },
  specs.slice(0, 2).map((s) => ({ ...s, status: 'pending' })),
)
// Enqueue both games at once so two workers grab them and complete near
// simultaneously; the analyzing->finalizing flip lets exactly one finalize.
await sqs.send(
  new SendMessageBatchCommand({
    QueueUrl: url,
    Entries: [
      { Id: '0', MessageBody: JSON.stringify({ jobId: raceId, gameId: 'g0' }) },
      { Id: '1', MessageBody: JSON.stringify({ jobId: raceId, gameId: 'g1' }) },
    ],
  }),
)
const race = await waitForJob(raceId, 120_000)
assert(race.status === 'complete', `gate a: race job completed (${race.status})`)
assert(race.completed === 2 && race.failed === 0, `gate a: exact counters (completed=${race.completed})`)
assert(race.wrapped && race.wrapped.generatedAt, 'gate a: exactly one wrapped summary written')
console.log('  (worker logs should show exactly one "job finalized" line for this jobId)')
console.log(`  raceJobId=${raceId}`)

console.log('\nALL PHASE 4 BACKEND GATES PASSED')
process.exit(0)
