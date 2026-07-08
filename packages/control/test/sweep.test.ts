import { expect, test } from 'vitest'
import { releaseStaleLocks } from '../src/sweep.js'
import { fakeDeps, byName } from './fake-deps.js'

const NOW = 1_800_000_000_000

const lock = (username: string, jobId: string, leaseExpiry: number) => ({
  pk: `LOCK#${username}`,
  sk: 'META',
  jobId,
  leaseExpiry,
})

test('sweep releases orphaned and terminal locks, keeps live ones', async () => {
  const jobs: Record<string, string | undefined> = {
    'running-job': 'analyzing',
    'done-job': 'complete',
    // 'orphan-job' has no job item: ingest was killed after taking the lock
  }
  const { deps, calls } = fakeDeps((call) => {
    if (call.name === 'ScanCommand') {
      return {
        Items: [
          lock('active', 'running-job', NOW + 60_000), // live lease, live job -> keep
          lock('orphan', 'orphan-job', NOW - 1), // gate d: expired, no job -> release
          lock('finished', 'done-job', NOW + 60_000), // live lease, terminal job -> release
          lock('stale', 'running-job', NOW - 1), // expired lease -> release per spec
        ],
      }
    }
    if (call.name === 'GetCommand') {
      const jobId = String(call.input.Key.pk).slice('JOB#'.length)
      return jobs[jobId] ? { Item: { status: jobs[jobId] } } : {}
    }
    return {}
  })

  const released = await releaseStaleLocks(deps, NOW)
  expect(released.map((r) => `${r.username}:${r.reason}`).sort()).toEqual([
    'finished:job-terminal',
    'orphan:expired',
    'stale:expired',
  ])
  const deletes = byName(calls, 'DeleteCommand')
  expect(deletes.map((d) => d.input.Key.pk).sort()).toEqual(['LOCK#finished', 'LOCK#orphan', 'LOCK#stale'])
  // deletes are conditioned on the exact lease seen at scan time
  for (const d of deletes) expect(d.input.ConditionExpression).toBe('leaseExpiry = :e')
})
