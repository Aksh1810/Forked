import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { expect, test } from 'vitest'
import { UserNotFoundError, type ArchiveGame, type ChessCom } from '../src/chesscom.js'
import type { ControlConfig } from '../src/env.js'
import { ingest } from '../src/ingest.js'
import { parseGamePgn } from '@forked/shared'
import { fakeDeps, byName, type Call } from './fake-deps.js'

const cfg: ControlConfig = {
  tableName: 't',
  region: 'us-east-1',
  dynamoEndpoint: undefined,
  sqsEndpoint: undefined,
  queueName: 'q',
  lambdaQueueName: undefined,
  gbSecondsBudget: 300_000,
  estimatedNps: 350_000,
  contactEmail: 'x@y.z',
  nodeBudget: 150_000,
  ratePerDay: 5,
  port: 0,
}

const ccf = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: 'conditional check failed' })

const SCHOLARS = `[Event "Live Chess"]
[White "attacker"]
[Black "kill_tester"]
[Result "1-0"]
[TimeControl "600"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`

const parsed = parseGamePgn(SCHOLARS)
if (!parsed.ok) throw new Error('fixture must parse')

const okGame: ArchiveGame = { id: 'g-ok', endTime: 1700000000, game: parsed, rejection: null }
const badGame: ArchiveGame = {
  id: 'g-bad',
  endTime: 1700000001,
  game: null,
  rejection: { code: 'variant', message: 'Variant games (chess960) are not supported.' },
}

const stubChessCom = (months: string[], gamesByMonth: Record<string, ArchiveGame[]>): ChessCom =>
  ({
    listMonths: async () => months,
    monthGames: async (_u: string, m: string) => gamesByMonth[m] ?? [],
  }) as unknown as ChessCom

// A job is one game, so every request that gets past validation carries all
// three of username, gameId and month.
const req = { username: 'kill_tester', gameId: 'g-ok', month: '2024-03', ip: '1.2.3.4' }
const march = stubChessCom(['2024-03'], { '2024-03': [okGame, badGame] })

test('bad usernames are rejected before any storage or network call', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, stubChessCom([], {}), { ...req, username: 'no spaces!' })
  expect(res).toMatchObject({ ok: false, status: 400, code: 'bad-request' })
  expect(calls).toHaveLength(0)
})

test('rate limit exhaustion returns 429', async () => {
  const { deps } = fakeDeps((call) => {
    if (call.name === 'UpdateCommand' && call.input.Key.pk.startsWith('RATE#')) throw ccf()
    return {}
  })
  const res = await ingest(deps, cfg, march, req)
  expect(res).toMatchObject({ ok: false, status: 429, code: 'rate-limited' })
})

test('a concurrent duplicate submission joins the running job', async () => {
  const { deps } = fakeDeps((call) => {
    if (call.name === 'PutCommand' && call.input.Item?.pk?.startsWith('LOCK#')) throw ccf()
    if (call.name === 'GetCommand' && call.input.Key.pk.startsWith('LOCK#')) {
      return { Item: { jobId: 'existing-job' } }
    }
    return {}
  })
  const res = await ingest(deps, cfg, march, req)
  expect(res).toEqual({ ok: true, jobId: 'existing-job', joined: true })
})

test('nonexistent username fails cleanly and releases the lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const cc = {
    monthGames: async () => {
      throw new UserNotFoundError('ghost')
    },
  } as unknown as ChessCom
  const res = await ingest(deps, cfg, cc, { ...req, username: 'ghost' })
  expect(res).toMatchObject({ ok: false, status: 404, code: 'user-not-found' })
  const deletes = byName(calls, 'DeleteCommand')
  expect(deletes).toHaveLength(1)
  expect(deletes[0].input.Key.pk).toBe('LOCK#ghost')
})

test('happy path: one-game job, its game item, miss enqueued, lease extended', async () => {
  const { deps, calls } = fakeDeps((call: Call) =>
    call.name === 'GetQueueUrlCommand' ? { QueueUrl: 'http://q' } : {},
  )
  const res = await ingest(deps, cfg, march, req)
  expect(res).toMatchObject({ ok: true, joined: false, total: 1 })

  const jobPut = byName(calls, 'PutCommand').find(
    (c) => String(c.input.Item.pk).startsWith('JOB#') && c.input.Item.sk === 'META',
  )!
  expect(jobPut.input.Item).toMatchObject({
    status: 'analyzing',
    gameId: 'g-ok',
    total: 1,
    completed: 0,
    failed: 0,
    username: 'kill_tester',
    gsi1pk: 'STATUS#analyzing',
  })

  // Only the requested game is written into the job, not the whole month.
  const gamePuts = byName(calls, 'PutCommand').filter((c) => String(c.input.Item.sk).startsWith('GAME#'))
  expect(gamePuts).toHaveLength(1)
  const item = gamePuts[0].input.Item
  expect(item).toMatchObject({ gameId: 'g-ok', status: 'pending', userColor: 'black' })
  expect(item.cacheKey).toHaveLength(64)

  const sends = byName(calls, 'SendMessageCommand')
  expect(sends).toHaveLength(1)
  expect(JSON.parse(sends[0].input.MessageBody)).toMatchObject({ gameId: 'g-ok' })

  const leaseUpdate = byName(calls, 'UpdateCommand').find((c) => c.input.Key.pk === 'LOCK#kill_tester')!
  expect(leaseUpdate.input.UpdateExpression).toContain('leaseExpiry')
  expect(byName(calls, 'DeleteCommand')).toHaveLength(0) // job created, lock kept
})

test('a cache hit completes inside ingest instead of reaching the queue', async () => {
  // The engine record for this game already exists, so ingest must settle the
  // job through THE completion transaction and never enqueue anything. Every
  // other test here answers GetCommand with {}, so this is the only coverage
  // of that branch — and it is the branch that runs for any game some other
  // user already analyzed.
  const cached = {
    cacheKey: 'x'.repeat(64),
    engineVersion: 'Stockfish 18',
    nodeBudget: cfg.nodeBudget,
    uciMoves: parsed.uciMoves,
    startEval: { type: 'cp', value: 0 },
    plies: parsed.uciMoves.map((played, i) => ({
      ply: i + 1,
      played,
      best: played,
      pv: [],
      evalAfter: { type: 'cp', value: 0 },
      classification: 'none',
      book: false,
    })),
  }
  const { deps, calls } = fakeDeps((call: Call) => {
    if (call.name === 'GetQueueUrlCommand') return { QueueUrl: 'http://q' }
    if (call.name === 'GetCommand' && String(call.input.Key.pk).startsWith('CACHE#')) {
      return { Item: { record: cached } }
    }
    return {}
  })
  const res = await ingest(deps, cfg, march, req)
  expect(res).toMatchObject({ ok: true, total: 1 })

  expect(byName(calls, 'SendMessageCommand')).toHaveLength(0) // never queued
  expect(byName(calls, 'TransactWriteCommand')).toHaveLength(1) // settled in-line
  const metrics = byName(calls, 'UpdateCommand').find((c) =>
    String(c.input.Key.pk).startsWith('METRICS#'),
  )!
  expect(metrics.input.ExpressionAttributeValues).toMatchObject({ ':h': 1 })
})

test('a game chess.com rejects is pre-counted as failed and never enqueued', async () => {
  const { deps, calls } = fakeDeps((call: Call) =>
    call.name === 'GetQueueUrlCommand' ? { QueueUrl: 'http://q' } : {},
  )
  const res = await ingest(deps, cfg, march, { ...req, gameId: 'g-bad' })
  expect(res).toMatchObject({ ok: true, total: 1 })

  const jobPut = byName(calls, 'PutCommand').find(
    (c) => String(c.input.Item.pk).startsWith('JOB#') && c.input.Item.sk === 'META',
  )!
  expect(jobPut.input.Item).toMatchObject({ total: 1, completed: 0, failed: 1 })

  const item = byName(calls, 'PutCommand').find((c) => String(c.input.Item.sk).startsWith('GAME#'))!.input.Item
  expect(item).toMatchObject({ status: 'failed', cacheKey: '', uciMoves: [] })
  expect(item.error).toContain('Variant')
  expect(byName(calls, 'SendMessageCommand')).toHaveLength(0)
})

test('a request without a month is rejected before any lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, march, { username: 'kill_tester', gameId: 'g-ok', ip: 'i' })
  expect(res).toMatchObject({ ok: false, status: 400, code: 'bad-request' })
  expect(calls).toHaveLength(0)
})

test('a malformed month is rejected before any lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, march, { ...req, month: '2024-3' })
  expect(res).toMatchObject({ ok: false, status: 400, code: 'bad-request' })
  expect(calls).toHaveLength(0)
})

test('a request without a game id is rejected before any lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, march, { username: 'kill_tester', month: '2024-03', ip: 'i' })
  expect(res).toMatchObject({ ok: false, status: 400, code: 'bad-request' })
  expect(calls).toHaveLength(0)
})

test('a missing game id returns no-games and releases the lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, march, { ...req, gameId: 'nope' })
  expect(res).toMatchObject({ ok: false, status: 404, code: 'no-games' })
  expect(byName(calls, 'DeleteCommand')).toHaveLength(1) // lock released, no job
})

test('rotating usernames still trips the per-IP limiter', async () => {
  const { deps } = fakeDeps((call) => {
    if (call.name === 'UpdateCommand' && call.input.Key.pk === 'RATE#@ip#1.2.3.4') throw ccf()
    return {}
  })
  const res = await ingest(deps, cfg, march, { ...req, username: 'fresh_name' })
  expect(res).toMatchObject({ ok: false, status: 429, code: 'rate-limited' })
})
