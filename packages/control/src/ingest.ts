import { randomUUID } from 'node:crypto'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import {
  PINNED_ENGINE_VERSION,
  analyzingGsiAttrs,
  cacheKey,
  emptyPartialAgg,
  gameKey,
  jobKey,
  lockKey,
  metricsKey,
  playerColor,
  rateKey,
  type GameItem,
} from '@forked/shared'
import {
  buildDoneOutcome,
  executeCompletion,
  getEngineRecord,
  log,
  tryFinalize,
  type Deps,
} from '@forked/worker'
import { UserNotFoundError, type ArchiveGame, type ChessCom } from './chesscom.js'
import type { ControlConfig } from './env.js'
import { makeRouter } from './route.js'

// A job is exactly one game: the archive game id plus the month it lives in,
// for a chess.com user. All three are required.
export interface IngestRequest {
  username?: string
  gameId?: string
  month?: string
  ip: string
}

export type IngestErrorCode =
  | 'bad-request'
  | 'user-not-found'
  | 'no-games'
  | 'rate-limited'
  | 'busy'
  | 'upstream'

export type IngestResponse =
  | { ok: true; jobId: string; joined: boolean; total?: number }
  | { ok: false; status: number; code: IngestErrorCode; message: string }

const err = (status: number, code: IngestErrorCode, message: string): IngestResponse => ({
  ok: false,
  status,
  code,
  message,
})

const USERNAME_RE = /^[a-zA-Z0-9_-]{1,50}$/
const MONTH_RE = /^\d{4}-\d{2}$/

// The initial lock lease only needs to cover the game fetch; once the job
// exists the lease is extended to the job's deadline, so an active job keeps
// its lock and an ingest killed mid-fetch leaves a lock the janitor sweep
// releases as soon as this lease expires.
const INGEST_LEASE_MS = 10 * 60_000

export async function ingest(
  deps: Deps,
  cfg: ControlConfig,
  chesscom: ChessCom,
  req: IngestRequest,
): Promise<IngestResponse> {
  const username = req.username?.trim().toLowerCase() || null
  if (!username || !USERNAME_RE.test(username)) {
    return err(400, 'bad-request', 'That does not look like a chess.com username.')
  }
  if (req.month && !MONTH_RE.test(req.month)) {
    return err(400, 'bad-request', 'Months must look like 2026-07.')
  }
  if (!req.gameId || !req.month) {
    return err(400, 'bad-request', 'Analyzing a game needs its id and the month it was played.')
  }

  try {
    await bumpRate(deps, username, req.ip, cfg.ratePerDay)
    // Second, coarser limiter on the IP alone: the per-(username, ip) counter
    // above resets with every new username, so rotating usernames would
    // otherwise buy unlimited jobs from one address. '@ip' cannot collide
    // with a real username ('@' fails USERNAME_RE).
    await bumpRate(deps, '@ip', req.ip, cfg.ratePerDay * 10)
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      return err(429, 'rate-limited', 'Daily analysis limit reached for this account. Try again tomorrow.')
    }
    throw e
  }

  const jobId = randomUUID()
  const lock = await acquireLock(deps, username, jobId)
  if (lock !== 'acquired') return lock

  let jobCreated = false
  try {
    const game = await fetchSingleGame(chesscom, username, req.gameId, req.month)
    if (!game) {
      return err(404, 'no-games', 'That game is not in this account and month.')
    }

    await createJobRecords(deps, cfg, jobId, username, game)
    jobCreated = true
    return { ok: true, jobId, joined: false, total: 1 }
  } catch (e) {
    if (e instanceof UserNotFoundError) {
      return err(404, 'user-not-found', 'That username does not exist on chess.com.')
    }
    log('error', 'ingest failed', { jobId, username, error: String(e) })
    return err(502, 'upstream', 'Could not fetch that game right now. Try again in a minute.')
  } finally {
    // Every path that did not produce a job releases the lock immediately
    // rather than making the user wait out the lease.
    if (!jobCreated) await releaseLock(deps, username, jobId)
  }
}

// Daily counter on the (who, ip) pair; throws ConditionalCheckFailedException
// past the cap. Exported so the other unauthenticated endpoints (the games
// browse list) share the same limiter.
export async function bumpRate(deps: Deps, who: string, ip: string, max: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  await deps.ddb.send(
    new UpdateCommand({
      TableName: deps.table,
      Key: rateKey(who, ip, day),
      ConditionExpression: 'attribute_not_exists(n) OR n < :max',
      UpdateExpression: 'ADD n :one SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':one': 1,
        ':max': max,
        ':ttl': Math.floor(Date.now() / 1000) + 2 * 86_400,
      },
    }),
  )
}

// THE PER-USERNAME LOCK. A conditional put wins only when no live lease
// exists. Losing returns the holder's jobId so a concurrent duplicate
// submission joins the running job as a viewer instead of starting another.
async function acquireLock(
  deps: Deps,
  username: string,
  jobId: string,
): Promise<'acquired' | IngestResponse> {
  const now = Date.now()
  try {
    await deps.ddb.send(
      new PutCommand({
        TableName: deps.table,
        Item: {
          ...lockKey(username),
          jobId,
          leaseExpiry: now + INGEST_LEASE_MS,
          // DynamoDB TTL backstop, well past any legitimate job.
          ttl: Math.floor(now / 1000) + 86_400,
          createdAt: new Date(now).toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(pk) OR leaseExpiry < :now',
        ExpressionAttributeValues: { ':now': now },
      }),
    )
    return 'acquired'
  } catch (e) {
    if (!(e instanceof ConditionalCheckFailedException)) throw e
    const cur = await deps.ddb.send(
      new GetCommand({ TableName: deps.table, Key: lockKey(username) }),
    )
    if (typeof cur.Item?.jobId === 'string') return { ok: true, jobId: cur.Item.jobId, joined: true }
    return err(409, 'busy', 'This account is being analyzed right now. Try again in a moment.')
  }
}

async function releaseLock(deps: Deps, username: string, jobId: string): Promise<void> {
  await deps.ddb
    .send(
      new DeleteCommand({
        TableName: deps.table,
        Key: lockKey(username),
        ConditionExpression: 'jobId = :j',
        ExpressionAttributeValues: { ':j': jobId },
      }),
    )
    .catch(() => {}) // already swept or re-acquired; nothing to release
}

// One game from the browse list: re-fetched from the (cached) month by id, so
// the analyze path never trusts client-supplied moves. A rejected game still
// flows through as a one-game job that fails that game (report shows why).
async function fetchSingleGame(
  chesscom: ChessCom,
  username: string,
  gameId: string,
  month: string,
): Promise<ArchiveGame | null> {
  const games = await chesscom.monthGames(username, month)
  return games.find((x) => x.id === gameId) ?? null
}

function toGameItem(
  jobId: string,
  g: ArchiveGame,
  username: string,
  nodeBudget: number,
  now: string,
): GameItem & { pk: string; sk: string } {
  const p = g.game
  const key = p ? cacheKey(p.uciMoves, PINNED_ENGINE_VERSION, nodeBudget) : ''
  const date = p?.date ?? (g.endTime ? new Date(g.endTime * 1000).toISOString().slice(0, 10) : null)
  return {
    ...gameKey(jobId, g.id),
    jobId,
    gameId: g.id,
    // Rejected games are failed at birth; they never see a queue or a worker.
    status: p ? 'pending' : 'failed',
    ...(p ? {} : { error: g.rejection?.message ?? 'Rejected at ingest.', finishedAt: now }),
    attempts: 0,
    cacheKey: key,
    uciMoves: p?.uciMoves ?? [],
    userColor: p ? playerColor(p, username) : null,
    nodeBudget,
    game: {
      gameId: g.id,
      white: p?.white ?? { name: '?', rating: null },
      black: p?.black ?? { name: '?', rating: null },
      timeControl: p?.timeControl ?? '?',
      result: p?.result ?? '*',
      date,
      clocks: p?.clocks ?? [],
      eco: p?.eco ?? null,
      openingName: p?.openingName ?? null,
      cacheKey: key,
    },
  }
}

async function createJobRecords(
  deps: Deps,
  cfg: ControlConfig,
  jobId: string,
  username: string,
  game: ArchiveGame,
): Promise<void> {
  const now = new Date()
  const item = toGameItem(jobId, game, username, cfg.nodeBudget, now.toISOString())
  // Rejected at ingest: failed at birth, so it never sees a queue or a worker.
  const rejected = item.status === 'failed'
  // ponytail: deadline heuristic, 10 minutes of slack plus 30s for the game;
  // the janitor recount makes an optimistic deadline self-correcting.
  const deadline = new Date(now.getTime() + 10 * 60_000 + (rejected ? 0 : 30_000))

  await deps.ddb.send(
    new PutCommand({
      TableName: deps.table,
      Item: {
        ...jobKey(jobId),
        ...analyzingGsiAttrs(deadline.toISOString()),
        jobId,
        username,
        // The job's one game id, so /j/:id can route straight to the report.
        gameId: game.id,
        status: 'analyzing',
        total: 1,
        completed: 0,
        // Initial value, not a counter increment: a game rejected at ingest is
        // counted here once and never touched by the completion path.
        failed: rejected ? 1 : 0,
        nodeBudget: cfg.nodeBudget,
        ring: [],
        agg: emptyPartialAgg(),
        createdAt: now.toISOString(),
        deadlineAt: deadline.toISOString(),
      },
    }),
  )

  await deps.ddb.send(new PutCommand({ TableName: deps.table, Item: item }))

  // A cache hit completes through THE transaction right now, without ever
  // touching the queue; a miss is routed (container vs Lambda) and enqueued.
  let hit = false
  let enqueued = false
  if (!rejected) {
    const record = await getEngineRecord(deps, item.cacheKey)
    if (record) {
      hit = true
      const outcome = buildDoneOutcome(
        { gameId: item.gameId, uciMoves: item.uciMoves, userColor: item.userColor, game: item.game },
        record,
        0,
      )
      if ((await executeCompletion(deps, jobId, item.gameId, outcome)) === 'applied') {
        await tryFinalize(deps, jobId)
      }
    } else {
      const pick = await makeRouter(deps, cfg)
      await deps.sqs.send(
        new SendMessageCommand({
          QueueUrl: pick(item.uciMoves.length, item.nodeBudget),
          MessageBody: JSON.stringify({ jobId, gameId: item.gameId }),
        }),
      )
      enqueued = true
    }
  }

  // A job with nothing pending (all cache hits or all rejects) finalizes now;
  // no completion transaction will ever run for it again.
  if (!enqueued) await tryFinalize(deps, jobId)

  await deps.ddb
    .send(
      new UpdateCommand({
        TableName: deps.table,
        Key: lockKey(username),
        ConditionExpression: 'jobId = :j',
        UpdateExpression: 'SET leaseExpiry = :e',
        ExpressionAttributeValues: { ':j': jobId, ':e': deadline.getTime() },
      }),
    )
    .catch(() => {}) // lock swept mid-ingest; the janitor owns that case

  await deps.ddb
    .send(
      new UpdateCommand({
        TableName: deps.table,
        Key: metricsKey(now.toISOString().slice(0, 10)),
        UpdateExpression: 'ADD jobsCreated :one, gamesIngested :g, cacheHits :h',
        ExpressionAttributeValues: { ':one': 1, ':g': 1, ':h': hit ? 1 : 0 },
      }),
    )
    .catch((e) => log('warn', 'metrics tick failed', { jobId, error: String(e) }))

  log('info', 'job created', { jobId, username, gameId: game.id, rejected, hit, enqueued })
}
