import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { expect, test } from 'vitest'
import type { WrappedSummary } from '@forked/shared'
import { updateLeaderboard } from '../src/finalize.js'
import { fakeDeps, byName, type Call } from './fake-deps.js'

const wrappedFixture = (over: Partial<WrappedSummary> = {}): WrappedSummary => ({
  version: 1,
  generatedAt: 'now',
  username: 'kill_tester',
  totalGames: 60,
  totalPositions: 1000,
  accuracy: 85,
  accuracyPercentile: null,
  flex: null,
  worstBlunder: {
    gameId: 'g1',
    opponent: 'rival',
    ply: 22,
    move: 'Qh4',
    lossPct: 41.5,
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    cliff: [50, 48, 7],
  },
  poisonOpening: null,
  timePressure: { overallAccuracy: null, underAccuracy: null, dropPct: null, buckets: [] },
  worstDay: null,
  delighter: null,
  archetype: { key: 'flag', name: 'The Flagger', description: 'd', mark: 'F' },
  accuracyByMonth: [],
  blunderRateByFamily: [],
  blunderRateByPhase: [],
  repeatedMistakes: [],
  games: [],
  ...over,
})

const leaderUser = (i: number, accuracy: number, over: Record<string, unknown> = {}) => ({
  sk: `USER#u${i}`,
  accuracy,
  games: 60,
  ...over,
})

test('user snapshot is conditional on biggest job and never touches optOut', async () => {
  const { deps, calls } = fakeDeps((call: Call) => (call.name === 'QueryCommand' ? { Items: [] } : {}))
  const wrapped = wrappedFixture()
  await updateLeaderboard(deps, 'job1', 'kill_tester', wrapped)

  const user = byName(calls, 'UpdateCommand').find((c) => c.input.Key.sk === 'USER#kill_tester')!
  expect(user.input.Key.pk).toBe('LEADER')
  expect(user.input.ConditionExpression).toBe('attribute_not_exists(games) OR games <= :g')
  expect(user.input.UpdateExpression).not.toContain('optOut')
  expect(user.input.ExpressionAttributeValues).toMatchObject({
    ':u': 'kill_tester',
    ':a': 85,
    ':g': 60,
    ':arch': { key: 'flag', name: 'The Flagger', mark: 'F' },
  })
  expect(wrapped.accuracyPercentile).toBeNull() // fewer than 10 ranked users
})

test('percentile fills at 10+ ranked users, ignoring sub-50-game and opted-out entries', async () => {
  // 10 ranked users, 4 below accuracy 85; a small-sample and an opted-out
  // user would push it to 12 entries but must not count.
  const users = [
    ...[70, 75, 80, 84].map((a, i) => leaderUser(i, a)),
    ...[86, 88, 90, 92, 94, 96].map((a, i) => leaderUser(10 + i, a)),
    leaderUser(20, 10, { games: 49 }),
    leaderUser(21, 11, { optOut: true }),
  ]
  const { deps } = fakeDeps((call: Call) => (call.name === 'QueryCommand' ? { Items: users } : {}))
  const wrapped = wrappedFixture()
  await updateLeaderboard(deps, 'job1', 'kill_tester', wrapped)
  expect(wrapped.accuracyPercentile).toBe(40)
})

test('blunder of the day: biggest loss wins, ttl set, reserved words aliased', async () => {
  const { deps, calls } = fakeDeps((call: Call) => (call.name === 'QueryCommand' ? { Items: [] } : {}))
  await updateLeaderboard(deps, 'job1', 'kill_tester', wrappedFixture())

  const blunder = byName(calls, 'UpdateCommand').find((c) =>
    String(c.input.Key.sk).startsWith('BLUNDER#'),
  )!
  expect(blunder.input.ConditionExpression).toBe('attribute_not_exists(lossPct) OR lossPct < :l')
  expect(blunder.input.ExpressionAttributeNames).toMatchObject({ '#mv': 'move', '#ttl': 'ttl' })
  expect(blunder.input.ExpressionAttributeValues).toMatchObject({ ':l': 41.5, ':g': 'g1', ':j': 'job1' })
  expect(blunder.input.ExpressionAttributeValues[':ttl']).toBeGreaterThan(Date.now() / 1000)
})

test('losing both conditions is swallowed; anything else propagates', async () => {
  const ccf = () =>
    new ConditionalCheckFailedException({ $metadata: {}, message: 'conditional check failed' })
  const { deps } = fakeDeps((call: Call) => {
    if (call.name === 'QueryCommand') return { Items: [] }
    throw ccf()
  })
  await expect(updateLeaderboard(deps, 'job1', 'kill_tester', wrappedFixture())).resolves.toBeUndefined()

  const { deps: badDeps } = fakeDeps((call: Call) => {
    if (call.name === 'QueryCommand') return { Items: [] }
    throw new Error('throttled')
  })
  await expect(updateLeaderboard(badDeps, 'job1', 'kill_tester', wrappedFixture())).rejects.toThrow('throttled')
})

test('null accuracy skips the snapshot and query; null blunder skips the blunder write', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  await updateLeaderboard(deps, 'job1', 'kill_tester', wrappedFixture({ accuracy: null, worstBlunder: null }))
  expect(calls).toHaveLength(0)
})
