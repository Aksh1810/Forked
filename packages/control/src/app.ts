import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { metricsKey } from '@forked/shared'
import type { Deps } from '@forked/worker'
import { UserNotFoundError, type ChessCom } from './chesscom.js'
import type { ControlConfig } from './env.js'
import { bumpRate, ingest } from './ingest.js'
import { getGameReport, getJobView, getUserGames } from './status.js'

const USERNAME_RE = /^[a-zA-Z0-9_-]{1,50}$/
const MONTH_RE = /^\d{4}-\d{2}$/
// Job ids are UUIDs we mint; game ids are chess.com uuids or pgn-N. Anything
// else 404s before touching storage (and before oversized strings reach a key).
const ID_RE = /^[a-zA-Z0-9-]{1,64}$/

// Rate-limit identity. On Lambda the trusted value is the Function URL's
// requestContext source IP; x-forwarded-for is client-supplied, and only its
// LAST entry (appended by the trusted hop) is believable, never the first.
function clientIp(c: Context): string {
  const event = (c.env as { event?: { requestContext?: { http?: { sourceIp?: string } } } })?.event
  const sourceIp = event?.requestContext?.http?.sourceIp
  if (sourceIp) return sourceIp
  const xff = c.req.header('x-forwarded-for')
  return (
    xff
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ??
    c.req.header('x-real-ip') ??
    'unknown'
  )
}

// The control-plane HTTP surface. Served locally by local.js; in Phase 5 the
// same app mounts behind a Lambda Function URL via hono/aws-lambda.
export function makeApp(
  deps: Deps,
  cfg: ControlConfig,
  chesscom: ChessCom,
  opts: { cors?: boolean } = {},
): Hono {
  const app = new Hono()
  // The Function URL emits CORS headers itself and doubled headers break
  // browsers, so the Lambda entry passes cors: false.
  if (opts.cors !== false) app.use(cors())

  app.get('/health', (c) => c.json({ ok: true }))

  app.post('/ingest', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)
    const ip = clientIp(c)
    const res = await ingest(deps, cfg, chesscom, {
      username: str('username'),
      gameId: str('gameId'),
      month: str('month'),
      ip,
    })
    return c.json(res, res.ok ? 200 : (res.status as ContentfulStatusCode))
  })

  // Browse list: a user's games for one month, metadata only, no analysis.
  app.get('/games/:username', async (c) => {
    const username = c.req.param('username')
    if (!USERNAME_RE.test(username)) {
      return c.json({ ok: false, code: 'bad-request' }, 400)
    }
    const month = c.req.query('month')
    if (month !== undefined && !MONTH_RE.test(month)) {
      return c.json({ ok: false, code: 'bad-request' }, 400)
    }
    // Per-IP daily cap: each uncached (username, month) pair writes up to a
    // 380KB archive item and hits chess.com upstream, so an unthrottled
    // crawler could bloat the table and hammer their API from our address.
    // 300/day is far past any real browsing session. '@games' cannot collide
    // with a real username ('@' fails USERNAME_RE).
    try {
      await bumpRate(deps, '@games', clientIp(c), 300)
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        return c.json({ ok: false, code: 'rate-limited' }, 429)
      }
      throw e
    }
    try {
      return c.json(await getUserGames(chesscom, username, month))
    } catch (e) {
      if (e instanceof UserNotFoundError) return c.json({ ok: false, code: 'user-not-found' }, 404)
      return c.json({ ok: false, code: 'upstream' }, 502)
    }
  })

  app.get('/job/:id', async (c) => {
    // Progress polling: cache per-client only, and only for a second (the
    // client polls faster than that, but stampedes/back-buttons get a freebie).
    c.header('Cache-Control', 'private, max-age=1')
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ ok: false, code: 'not-found' }, 404)
    const view = await getJobView(deps, id, c.req.query('failures') === '1')
    return view ? c.json(view) : c.json({ ok: false, code: 'not-found' }, 404)
  })

  app.get('/job/:id/game/:gameId', async (c) => {
    const id = c.req.param('id')
    const gameId = c.req.param('gameId')
    if (!ID_RE.test(id) || !ID_RE.test(gameId)) return c.json({ ok: false, code: 'not-found' }, 404)
    const report = await getGameReport(deps, id, gameId)
    return report ? c.json(report) : c.json({ ok: false, code: 'not-found' }, 404)
  })

  // Landing-page ticker: the one all-time counter item.
  app.get('/metrics', async (c) => {
    c.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    const out = await deps.ddb.send(
      new GetCommand({ TableName: deps.table, Key: metricsKey('TOTAL') }),
    )
    return c.json({
      positions: Number(out.Item?.positions ?? 0),
      games: Number(out.Item?.games ?? 0),
    })
  })

  return app
}
