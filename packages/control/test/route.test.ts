import { expect, test } from 'vitest'
import { makeRouter } from '../src/route.js'
import { fakeDeps, byName } from './fake-deps.js'

const CFG = { queueName: 'q', lambdaQueueName: 'ql', gbSecondsBudget: 300_000, estimatedNps: 350_000 }

// At nodeBudget 600k and NPS 350k a ply costs ~1.71s, so the 600s cutoff
// lands at 350 plies: 100 plies fits Lambda, 400 does not.
const BUDGET = 600_000

const respond = (spent: number) => (call: { name: string; input: Record<string, unknown> }) => {
  if (call.name === 'GetQueueUrlCommand') return { QueueUrl: `http://${call.input.QueueName as string}` }
  if (call.name === 'GetCommand') return { Item: { lambdaGbSeconds: spent } }
  return {}
}

test('lambdaQueueName unset: everything routes to the container queue, no budget read', async () => {
  const { deps, calls } = fakeDeps(respond(0))
  const pick = await makeRouter(deps, { ...CFG, lambdaQueueName: undefined })
  expect(pick(10, BUDGET)).toBe('http://q')
  expect(pick(1000, BUDGET)).toBe('http://q')
  expect(byName(calls, 'GetQueueUrlCommand')).toHaveLength(1)
  expect(byName(calls, 'GetCommand')).toHaveLength(0)
})

test('budget exhausted: everything routes to the container queue', async () => {
  const { deps } = fakeDeps(respond(300_000))
  const pick = await makeRouter(deps, CFG)
  expect(pick(10, BUDGET)).toBe('http://q')
})

test('budget available: short games go to Lambda, long estimates stay on the container', async () => {
  const { deps, calls } = fakeDeps(respond(100_000))
  const pick = await makeRouter(deps, CFG)
  expect(pick(100, BUDGET)).toBe('http://ql')
  expect(pick(400, BUDGET)).toBe('http://q')
  // both URLs and the budget were resolved exactly once for any number of picks
  pick(50, BUDGET)
  expect(byName(calls, 'GetQueueUrlCommand')).toHaveLength(2)
  expect(byName(calls, 'GetCommand')).toHaveLength(1)
})

test('no metrics item yet counts as zero spent', async () => {
  const { deps } = fakeDeps((call) =>
    call.name === 'GetQueueUrlCommand'
      ? { QueueUrl: `http://${call.input.QueueName as string}` }
      : {},
  )
  const pick = await makeRouter(deps, CFG)
  expect(pick(100, BUDGET)).toBe('http://ql')
})
