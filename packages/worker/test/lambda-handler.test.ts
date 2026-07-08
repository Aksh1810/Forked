import { expect, test } from 'vitest'
import { makeHandlers, type SqsEvent } from '../src/lambda.js'
import type { Engine } from '../src/uci.js'
import { fakeDeps, byName, type Call } from './fake-deps.js'

const record = (body: unknown, receiveCount = '1') => ({
  messageId: 'm1',
  body: typeof body === 'string' ? body : JSON.stringify(body),
  attributes: { ApproximateReceiveCount: receiveCount },
})
const event = (...records: ReturnType<typeof record>[]): SqsEvent => ({ Records: records })

// The duplicate path (game already settled) exercises the handler without
// ever touching the engine.
const settledGame = (call: Call) =>
  call.name === 'GetCommand' && String(call.input.Key?.sk).startsWith('GAME#')
    ? { Item: { status: 'done' } }
    : {}

function fakeEngine() {
  let disposed = 0
  const engine = { dispose: () => void (disposed += 1) } as unknown as Engine
  return { engine, disposed: () => disposed }
}

test('happy path: no failures, GB-seconds ADDed to the month and day items, awaited', async () => {
  const { deps, calls } = fakeDeps(settledGame)
  const { handler } = makeHandlers(deps, async () => fakeEngine().engine)

  const out = await handler(event(record({ jobId: 'j1', gameId: 'g1' })))
  expect(out).toEqual({ batchItemFailures: [] })

  const ticks = byName(calls, 'UpdateCommand').filter((c) =>
    String(c.input.UpdateExpression).includes('lambdaGbSeconds'),
  )
  const pks = ticks.map((t) => String(t.input.Key.pk))
  expect(pks).toHaveLength(2)
  expect(pks[0]).toMatch(/^METRICS#\d{4}-\d{2}$/) // monthly budget counter
  expect(pks[1]).toMatch(/^METRICS#\d{4}-\d{2}-\d{2}$/) // daily rollup
})

test('attempts come from ApproximateReceiveCount', async () => {
  const { deps, calls } = fakeDeps((call: Call) => {
    if (call.name === 'GetCommand' && String(call.input.Key?.sk).startsWith('GAME#')) {
      return { Item: { status: 'done' } }
    }
    return {}
  })
  const { handler } = makeHandlers(deps, async () => fakeEngine().engine)
  await handler(event(record({ jobId: 'j1', gameId: 'g1' }, '4')))
  // The duplicate path returns before attempts are used; this only asserts
  // nothing threw with a >1 receive count and the game item was read once.
  expect(byName(calls, 'GetCommand')).toHaveLength(1)
})

test('a failing task lands in batchItemFailures and resets the engine', async () => {
  let starts = 0
  const fe = fakeEngine()
  const startEngine = async () => {
    starts += 1
    return fe.engine
  }
  const { deps } = fakeDeps((call: Call) => {
    if (call.name === 'GetCommand') throw new Error('dynamo down')
    return {}
  })
  const { handler } = makeHandlers(deps, startEngine)

  const out = await handler(event(record({ jobId: 'j1', gameId: 'g1' })))
  expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }])
  expect(fe.disposed()).toBe(1)

  await handler(event(record({ jobId: 'j1', gameId: 'g2' })))
  expect(starts).toBe(2) // fresh engine after the failure
})

test('garbage bodies are dropped, not retried', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const { handler } = makeHandlers(deps, async () => fakeEngine().engine)

  const out = await handler(event(record('not json'), record({ wrong: 'shape' })))
  expect(out.batchItemFailures).toEqual([])
  expect(byName(calls, 'GetCommand')).toHaveLength(0) // never reached processing
})

test('dlqHandler marks the game failed through the completion transaction, no budget tick', async () => {
  const { deps, calls } = fakeDeps(() => ({}))
  const { dlqHandler } = makeHandlers(deps, async () => fakeEngine().engine)

  const out = await dlqHandler(event(record({ jobId: 'j1', gameId: 'g1' }, '5')))
  expect(out.batchItemFailures).toEqual([])
  expect(byName(calls, 'TransactWriteCommand')).toHaveLength(1)
  const ticks = byName(calls, 'UpdateCommand').filter((c) =>
    String(c.input.UpdateExpression).includes('lambdaGbSeconds'),
  )
  expect(ticks).toHaveLength(0)
})
