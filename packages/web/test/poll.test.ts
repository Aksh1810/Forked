import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { poll } from '../src/lib/poll'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('polls immediately, then on the schedule it is given', async () => {
  const seen: number[] = []
  let n = 0
  poll(
    async () => ++n,
    (v) => {
      seen.push(v)
      return 'again'
    },
    () => 1000,
  )

  await vi.advanceTimersByTimeAsync(0)
  expect(seen).toEqual([1])
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(seen).toEqual([1, 2, 3])
})

test('the delay is recomputed each round from elapsed time', async () => {
  const delays: number[] = []
  poll(
    async () => null,
    () => 'again',
    (elapsed) => {
      delays.push(elapsed)
      return elapsed > 2500 ? 5000 : 1000
    },
  )

  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(1000)
  // Fourth round is scheduled past the 2500ms threshold, so it waits 5s: a
  // 1s advance is no longer enough to produce another round.
  const roundsBefore = delays.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(delays.length).toBe(roundsBefore)
  await vi.advanceTimersByTimeAsync(4000)
  expect(delays.length).toBe(roundsBefore + 1)
})

test('done stops the loop for good', async () => {
  let calls = 0
  poll(
    async () => ++calls,
    (v) => (v === 2 ? 'done' : 'again'),
    () => 1000,
  )

  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(5000)
  expect(calls).toBe(2)
})

test('cancelling drops a response that lands after it', async () => {
  const seen: string[] = []
  let release: (v: string) => void = () => {}
  const cancel = poll(
    () => new Promise<string>((r) => (release = r)),
    (v) => {
      seen.push(v)
      return 'again'
    },
    () => 1000,
  )

  cancel()
  release('late')
  await vi.advanceTimersByTimeAsync(5000)
  expect(seen).toEqual([])
})

test('cancelling stops a scheduled round', async () => {
  let calls = 0
  const cancel = poll(
    async () => ++calls,
    () => 'again',
    () => 1000,
  )

  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toBe(1)
  cancel()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(calls).toBe(1)
})
