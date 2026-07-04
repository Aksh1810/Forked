// Gate (f): the identical job run a second time is entirely cache hits:
// zero new queue messages, byte-identical results.
import { assert, createJob, ddb, ensureTable, listGames, TABLE, waitForJob } from '../local/harness.mjs'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { cacheItemKey } from '../../packages/shared/dist/index.js'
import { generateGames } from '../local/gen-games.mjs'

await ensureTable()
const pgns = generateGames(3, { seed: 606 })

const runX = await createJob(pgns, { nodeBudget: 120_000 })
assert(runX.enqueued === 3, `first run enqueued all 3 games (got ${runX.enqueued})`)
const jobX = await waitForJob(runX.jobId)
assert(jobX.completed === 3 && jobX.failed === 0, 'first run completed cleanly')

// snapshot the cached engine records
const gamesX = await listGames(runX.jobId)
const recordsX = {}
for (const g of gamesX) {
  const item = await ddb.send(new GetCommand({ TableName: TABLE, Key: cacheItemKey(g.cacheKey) }))
  recordsX[g.cacheKey] = { json: JSON.stringify(item.Item.record), createdAt: item.Item.createdAt }
}

const runY = await createJob(pgns, { nodeBudget: 120_000 })
assert(runY.enqueued === 0, `second run enqueued ZERO messages (got ${runY.enqueued})`)
const jobY = await waitForJob(runY.jobId, 30_000)
assert(jobY.status === 'complete', 'second run completed purely from cache')
assert(jobY.completed === 3 && jobY.failed === 0, 'second run counters match')

const accX = jobX.ring.map((r) => r.accuracy).sort()
const accY = jobY.ring.map((r) => r.accuracy).sort()
assert(JSON.stringify(accX) === JSON.stringify(accY), 'per-game accuracies byte-identical across runs')

const gamesY = await listGames(runY.jobId)
for (const g of gamesY) {
  const item = await ddb.send(new GetCommand({ TableName: TABLE, Key: cacheItemKey(g.cacheKey) }))
  assert(
    JSON.stringify(item.Item.record) === recordsX[g.cacheKey].json,
    `engine record for ${g.gameId} byte-identical`,
  )
  assert(
    item.Item.createdAt === recordsX[g.cacheKey].createdAt,
    `engine record for ${g.gameId} was reused, not rewritten`,
  )
}
console.log('GATE F PASSED')
