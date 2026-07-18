import { expect, test } from 'vitest'
import { makeApp } from '../src/app.js'
import { loadControlConfig } from '../src/env.js'
import { fakeDeps } from './fake-deps.js'
import type { ChessCom } from '../src/chesscom.js'

const cfg = loadControlConfig({} as NodeJS.ProcessEnv)
const chesscom = {} as ChessCom

test('leaderboard and metrics are CDN-cacheable; job status is per-client only', async () => {
  const { deps } = fakeDeps(() => ({}))
  const app = makeApp(deps, cfg, chesscom, { cors: false })

  const board = await app.request('/leaderboard')
  expect(board.headers.get('Cache-Control')).toBe('public, s-maxage=60, stale-while-revalidate=300')

  const metrics = await app.request('/metrics')
  expect(metrics.headers.get('Cache-Control')).toBe('public, s-maxage=60, stale-while-revalidate=300')

  const job = await app.request('/job/some-job-id')
  expect(job.headers.get('Cache-Control')).toBe('private, max-age=1')
})

test('the browse list rate-limits per IP', async () => {
  const { ConditionalCheckFailedException } = await import('@aws-sdk/client-dynamodb')
  const { deps } = fakeDeps((call) => {
    if (call.name === 'UpdateCommand' && String(call.input.Key?.pk).startsWith('RATE#@games#')) {
      throw new ConditionalCheckFailedException({ $metadata: {}, message: 'conditional check failed' })
    }
    return {}
  })
  const app = makeApp(deps, cfg, chesscom, { cors: false })
  const res = await app.request('/games/somebody')
  expect(res.status).toBe(429)
  expect(await res.json()).toMatchObject({ ok: false, code: 'rate-limited' })
})
