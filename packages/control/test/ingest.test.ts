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
  maxGamesPerJob: 5,
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

const req = { username: 'kill_tester', ip: '1.2.3.4' }

test('bad usernames are rejected before any storage or network call', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, stubChessCom([], {}), { username: 'no spaces!', ip: 'i' })
  expect(res).toMatchObject({ ok: false, status: 400, code: 'bad-request' })
  expect(calls).toHaveLength(0)
})

test('rate limit exhaustion returns 429', async () => {
  const { deps } = fakeDeps((call) => {
    if (call.name === 'UpdateCommand' && call.input.Key.pk.startsWith('RATE#')) throw ccf()
    return {}
  })
  const res = await ingest(deps, cfg, stubChessCom([], {}), req)
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
  const res = await ingest(deps, cfg, stubChessCom([], {}), req)
  expect(res).toEqual({ ok: true, jobId: 'existing-job', joined: true })
})

test('nonexistent username fails cleanly and releases the lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const cc = {
    listMonths: async () => {
      throw new UserNotFoundError('ghost')
    },
  } as unknown as ChessCom
  const res = await ingest(deps, cfg, cc, { username: 'ghost', ip: 'i' })
  expect(res).toMatchObject({ ok: false, status: 404, code: 'user-not-found' })
  const deletes = byName(calls, 'DeleteCommand')
  expect(deletes).toHaveLength(1)
  expect(deletes[0].input.Key.pk).toBe('LOCK#ghost')
})

test('an archive past the cap aborts with date-range guidance, newest months first', async () => {
  const seen: string[] = []
  const months = ['2024-01', '2024-02', '2024-03']
  const perMonth = Object.fromEntries(
    months.map((m) => [m, [0, 1, 2].map((i) => ({ ...okGame, id: `${m}-${i}` }))]),
  )
  const cc = {
    listMonths: async () => months,
    monthGames: async (_u: string, m: string) => {
      seen.push(m)
      return perMonth[m]
    },
  } as unknown as ChessCom
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, { ...cfg, maxGamesPerJob: 4 }, cc, req)
  expect(res).toMatchObject({ ok: false, status: 422, code: 'archive-too-large' })
  expect(seen).toEqual(['2024-03', '2024-02']) // newest first, stopped early
  expect(byName(calls, 'DeleteCommand')).toHaveLength(1) // lock released
})

test('happy path: job + game items, reject pre-counted as failed, miss enqueued, lease extended', async () => {
  const { deps, calls } = fakeDeps((call: Call) => {
    if (call.name === 'GetQueueUrlCommand') return { QueueUrl: 'http://q' }
    return {} // no cache hits, everything else succeeds
  })
  const res = await ingest(deps, cfg, stubChessCom(['2024-03'], { '2024-03': [okGame, badGame] }), req)
  expect(res).toMatchObject({ ok: true, joined: false, total: 2 })

  const jobPut = byName(calls, 'PutCommand').find((c) => String(c.input.Item.pk).startsWith('JOB#'))!
  expect(jobPut.input.Item).toMatchObject({
    status: 'analyzing',
    total: 2,
    completed: 0,
    failed: 1,
    username: 'kill_tester',
    gsi1pk: 'STATUS#analyzing',
  })

  const batch = byName(calls, 'BatchWriteCommand')[0].input.RequestItems.t
  expect(batch).toHaveLength(2)
  const items = batch.map((r: { PutRequest: { Item: Record<string, unknown> } }) => r.PutRequest.Item)
  const ok = items.find((i: Record<string, unknown>) => i.gameId === 'g-ok')!
  const bad = items.find((i: Record<string, unknown>) => i.gameId === 'g-bad')!
  expect(ok).toMatchObject({ status: 'pending', userColor: 'black' })
  expect(ok.cacheKey).toHaveLength(64)
  expect(bad).toMatchObject({ status: 'failed', cacheKey: '', uciMoves: [] })
  expect(bad.error).toContain('Variant')

  const sends = byName(calls, 'SendMessageBatchCommand')
  expect(sends).toHaveLength(1)
  expect(JSON.parse(sends[0].input.Entries[0].MessageBody)).toMatchObject({ gameId: 'g-ok' })

  const leaseUpdate = byName(calls, 'UpdateCommand').find((c) => c.input.Key.pk === 'LOCK#kill_tester')!
  expect(leaseUpdate.input.UpdateExpression).toContain('leaseExpiry')
  expect(byName(calls, 'DeleteCommand')).toHaveLength(0) // job created, lock kept
})

test('single-game analyze builds a one-game job tagged single', async () => {
  const { deps, calls } = fakeDeps((call: Call) =>
    call.name === 'GetQueueUrlCommand' ? { QueueUrl: 'http://q' } : {},
  )
  const res = await ingest(deps, cfg, stubChessCom(['2024-03'], { '2024-03': [okGame, badGame] }), {
    username: 'kill_tester',
    gameId: 'g-ok',
    month: '2024-03',
    ip: 'i',
  })
  expect(res).toMatchObject({ ok: true, joined: false, total: 1 })

  const jobPut = byName(calls, 'PutCommand').find((c) => String(c.input.Item.pk).startsWith('JOB#'))!
  expect(jobPut.input.Item).toMatchObject({ kind: 'single', gameId: 'g-ok', total: 1, status: 'analyzing' })

  const batch = byName(calls, 'BatchWriteCommand')[0].input.RequestItems.t
  expect(batch).toHaveLength(1)
  expect(batch[0].PutRequest.Item.gameId).toBe('g-ok')
})

test('single-game analyze without a month is rejected before any lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, stubChessCom([], {}), {
    username: 'kill_tester',
    gameId: 'g-ok',
    ip: 'i',
  })
  expect(res).toMatchObject({ ok: false, status: 400, code: 'bad-request' })
  expect(calls).toHaveLength(0)
})

test('single-game analyze of a missing id returns no-games and releases the lock', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const res = await ingest(deps, cfg, stubChessCom(['2024-03'], { '2024-03': [okGame] }), {
    username: 'kill_tester',
    gameId: 'nope',
    month: '2024-03',
    ip: 'i',
  })
  expect(res).toMatchObject({ ok: false, status: 404, code: 'no-games' })
  expect(byName(calls, 'DeleteCommand')).toHaveLength(1) // lock released, no job
})

test('pasted PGN needs no username, no lock, and gets stable game ids', async () => {
  const { deps, calls } = fakeDeps((call) =>
    call.name === 'GetQueueUrlCommand' ? { QueueUrl: 'http://q' } : {},
  )
  const res = await ingest(deps, cfg, stubChessCom([], {}), {
    pgn: `${SCHOLARS}\n\n${SCHOLARS}`,
    ip: 'i',
  })
  expect(res).toMatchObject({ ok: true, total: 2 })
  const locks = calls.filter((c) => String(c.input.Item?.pk ?? c.input.Key?.pk).startsWith('LOCK#'))
  expect(locks).toHaveLength(0)
  const batch = byName(calls, 'BatchWriteCommand')[0].input.RequestItems.t
  expect(batch.map((r: { PutRequest: { Item: { gameId: string } } }) => r.PutRequest.Item.gameId)).toEqual([
    'pgn-1',
    'pgn-2',
  ])
})

test('a PGN paste past the per-job cap is rejected before any job is created', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const paste = Array.from({ length: 7 }, () => SCHOLARS).join('\n\n')
  const res = await ingest(deps, { ...cfg, maxGamesPerJob: 5 }, stubChessCom([], {}), {
    pgn: paste,
    ip: 'i',
  })
  expect(res).toMatchObject({ ok: false, status: 422, code: 'archive-too-large' })
  expect(byName(calls, 'PutCommand')).toHaveLength(0) // no job, no game items
  expect(byName(calls, 'SendMessageBatchCommand')).toHaveLength(0)
})
