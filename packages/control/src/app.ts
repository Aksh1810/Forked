import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { leaderUserKey, metricsKey } from '@forked/shared'
import type { Deps } from '@forked/worker'
import { UserNotFoundError, type ChessCom } from './chesscom.js'
import type { ControlConfig } from './env.js'
import { bumpRate, ingest } from './ingest.js'
import { getGameReport, getJobView, getUserGames } from './status.js'

const USERNAME_RE = /^[a-zA-Z0-9_-]{1,50}$/
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
      pgn: str('pgn'),
      from: str('from'),
      to: str('to'),
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
    try {
      return c.json(await getUserGames(chesscom, username, c.req.query('month')))
    } catch (e) {
      if (e instanceof UserNotFoundError) return c.json({ ok: false, code: 'user-not-found' }, 404)
      return c.json({ ok: false, code: 'upstream' }, 502)
    }
  })

  app.get('/job/:id', async (c) => {
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

  // Public leaderboard: the whole board lives in one partition, so a single
  // Query serves both tabs. Rank floor is 50 games; opted-out users never
  // appear.
  app.get('/leaderboard', async (c) => {
    const out = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'LEADER' },
      }),
    )
    const items = (out.Items ?? []) as Record<string, unknown>[]
    const users = items
      .filter((i) => String(i.sk).startsWith('USER#') && Number(i.games ?? 0) >= 50 && !i.optOut)
      .map((i) => ({
        username: i.username as string,
        accuracy: i.accuracy as number,
        games: i.games as number,
        archetype: i.archetype as { key: string; name: string; mark: string },
      }))
      .sort((a, b) => b.accuracy - a.accuracy)

    // Today's blunder if one landed already, else yesterday's: the UTC
    // boundary would otherwise blank the tab every morning.
    const blunders = new Map(items.filter((i) => String(i.sk).startsWith('BLUNDER#')).map((i) => [i.sk as string, i]))
    const today = new Date()
    const b =
      blunders.get(`BLUNDER#${today.toISOString().slice(0, 10)}`) ??
      blunders.get(`BLUNDER#${new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)}`)
    const blunder = b
      ? {
          username: b.username as string,
          jobId: b.jobId as string,
          gameId: b.gameId as string,
          opponent: b.opponent as string,
          move: b.move as string,
          ply: b.ply as number,
          lossPct: b.lossPct as number,
          fen: b.fen as string,
          cliff: b.cliff as number[],
        }
      : null
    return c.json({ users, blunder })
  })

  // Unauthenticated by design: the board only shows public chess.com data,
  // and this endpoint can only hide an entry, never fabricate a ranking.
  // Unconditional upsert on purpose: an opt-out placed while a job is still
  // analyzing leaves a stub the later finalize SETs around (it never touches
  // optOut), so removal wins that race permanently. Stubs have no games
  // attribute and can never render.
  app.post('/leaderboard/remove', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
    if (!USERNAME_RE.test(username)) return c.json({ ok: false, code: 'bad-request' }, 400)
    // Per-IP daily cap: the upsert would otherwise let one client write
    // unbounded stub items into the LEADER partition.
    try {
      await bumpRate(deps, 'leader-remove', clientIp(c), 20)
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        return c.json({ ok: false, code: 'rate-limited' }, 429)
      }
      throw e
    }
    await deps.ddb.send(
      new UpdateCommand({
        TableName: deps.table,
        Key: leaderUserKey(username),
        UpdateExpression: 'SET optOut = :t',
        ExpressionAttributeValues: { ':t': true },
      }),
    )
    return c.json({ ok: true })
  })

  // Landing-page ticker: the one all-time counter item.
  app.get('/metrics', async (c) => {
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
