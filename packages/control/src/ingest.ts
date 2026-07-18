import { randomUUID } from 'node:crypto'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import {
  PINNED_ENGINE_VERSION,
  analyzingGsiAttrs,
  cacheKey,
  emptyPartialAgg,
  gameKey,
  jobKey,
  lockKey,
  metricsKey,
  parseAllGamesPgn,
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

export interface IngestRequest {
  username?: string
  pgn?: string
  from?: string // 'YYYY-MM', inclusive
  to?: string
  // Single-game analyze from the browse list: the archive game id plus the
  // month it lives in. Both required together; builds a one-game job.
  gameId?: string
  month?: string
  ip: string
}

export type IngestErrorCode =
  | 'bad-request'
  | 'user-not-found'
  | 'no-games'
  | 'archive-too-large'
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

// Paste-path ceiling checked BEFORE parsing: maxGamesPerJob only counts games
// after the whole text is parsed, so without this a single multi-megabyte POST
// buys an unbounded chessops parse. ~2MB comfortably covers 500 real games.
const MAX_PGN_CHARS = 2_000_000

// The initial lock lease only needs to cover the archive fetch; once the job
// exists the lease is extended to the job's deadline, so an active job keeps
// its lock and an ingest killed mid-fetch leaves a lock the janitor sweep
// releases as soon as this lease expires.
const INGEST_LEASE_MS = 10 * 60_000

class ArchiveTooLargeError extends Error {}

export async function ingest(
  deps: Deps,
  cfg: ControlConfig,
  chesscom: ChessCom,
  req: IngestRequest,
): Promise<IngestResponse> {
  const username = req.username?.trim().toLowerCase() || null
  if (!username && !req.pgn?.trim()) {
    return err(400, 'bad-request', 'Provide a chess.com username or PGN text.')
  }
  if (username && !USERNAME_RE.test(username)) {
    return err(400, 'bad-request', 'That does not look like a chess.com username.')
  }
  for (const m of [req.from, req.to, req.month]) {
    if (m && !MONTH_RE.test(m)) return err(400, 'bad-request', 'Months must look like 2026-07.')
  }
  const single = Boolean(req.gameId)
  if (single && (!username || !req.month)) {
    return err(400, 'bad-request', 'Analyzing one game needs a username and its month.')
  }
  if (req.pgn && req.pgn.length > MAX_PGN_CHARS) {
    return err(422, 'archive-too-large', 'That PGN paste is too large. Split it into smaller batches.')
  }

  try {
    await bumpRate(deps, username ?? 'pgn-paste', req.ip, cfg.ratePerDay)
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
  if (username) {
    const lock = await acquireLock(deps, username, jobId)
    if (lock !== 'acquired') return lock
  }

  let jobCreated = false
  try {
    const games = single
      ? await fetchSingleGame(chesscom, username as string, req)
      : username
        ? await fetchArchiveGames(cfg, chesscom, username, req)
        : pastedGames(req.pgn ?? '')
    // The archive fetch enforces this while fetching; the paste path must
    // enforce it too or a single POST creates an unbounded job.
    if (games.length > cfg.maxGamesPerJob) throw new ArchiveTooLargeError()
    if (games.length === 0) {
      return single
        ? err(404, 'no-games', 'That game is not in this account and month.')
        : err(404, 'no-games', 'This account has no games in that range.')
    }

    await createJobRecords(deps, cfg, jobId, username, games, single ? 'single' : 'archive')
    jobCreated = true
    return { ok: true, jobId, joined: false, total: games.length }
  } catch (e) {
    if (e instanceof UserNotFoundError) {
      return err(404, 'user-not-found', 'That username does not exist on chess.com.')
    }
    if (e instanceof ArchiveTooLargeError) {
      return err(
        422,
        'archive-too-large',
        `That archive has more than ${cfg.maxGamesPerJob} games. Pick a date range.`,
      )
    }
    log('error', 'ingest failed', { jobId, username, error: String(e) })
    return err(502, 'upstream', 'Could not fetch that archive right now. Try again in a minute.')
  } finally {
    // Every path that did not produce a job releases the lock immediately
    // rather than making the user wait out the lease.
    if (username && !jobCreated) await releaseLock(deps, username, jobId)
  }
}

// Daily counter on the (who, ip) pair; throws ConditionalCheckFailedException
// past the cap. Exported so other unauthenticated write endpoints (the
// leaderboard opt-out) share the same limiter.
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

// Months newest first, so the per-job cap lands on the user's most recent
// games and oversized archives abort without fetching all of history.
async function fetchArchiveGames(
  cfg: ControlConfig,
  chesscom: ChessCom,
  username: string,
  req: IngestRequest,
): Promise<ArchiveGame[]> {
  const months = await chesscom.listMonths(username)
  const inRange = months
    .filter((m) => (!req.from || m >= req.from) && (!req.to || m <= req.to))
    .reverse()
  const picked: ArchiveGame[] = []
  let accepted = 0
  for (const month of inRange) {
    const games = await chesscom.monthGames(username, month)
    picked.push(...games)
    accepted += games.filter((g) => g.game).length
    if (accepted > cfg.maxGamesPerJob) throw new ArchiveTooLargeError()
  }
  return picked
}

// One game from the browse list: re-fetched from the (cached) month by id, so
// the analyze path never trusts client-supplied moves. A rejected game still
// flows through as a one-game job that fails that game (report shows why).
async function fetchSingleGame(
  chesscom: ChessCom,
  username: string,
  req: IngestRequest,
): Promise<ArchiveGame[]> {
  const games = await chesscom.monthGames(username, req.month as string)
  const g = games.find((x) => x.id === req.gameId)
  return g ? [g] : []
}

function pastedGames(pgn: string): ArchiveGame[] {
  return parseAllGamesPgn(pgn).map((p, i) => ({
    id: `pgn-${i + 1}`,
    endTime: 0,
    game: p.ok ? p : null,
    rejection: p.ok ? null : { code: p.code, message: p.message },
  }))
}

function toGameItem(
  jobId: string,
  g: ArchiveGame,
  username: string | null,
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
    userColor:
      p && username && p.white.name.toLowerCase() === username
        ? 'white'
        : p && username && p.black.name.toLowerCase() === username
          ? 'black'
          : null,
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
  username: string | null,
  games: ArchiveGame[],
  kind: 'archive' | 'single',
): Promise<void> {
  const now = new Date()
  const items = games.map((g) => toGameItem(jobId, g, username, cfg.nodeBudget, now.toISOString()))
  const rejected = items.filter((i) => i.status === 'failed').length
  // ponytail: deadline heuristic, 10 minutes of slack plus 30s per game; the
  // janitor recount makes an optimistic deadline self-correcting.
  const deadline = new Date(now.getTime() + 10 * 60_000 + (items.length - rejected) * 30_000)

  await deps.ddb.send(
    new PutCommand({
      TableName: deps.table,
      Item: {
        ...jobKey(jobId),
        ...analyzingGsiAttrs(deadline.toISOString()),
        jobId,
        username,
        // A single-game job carries its one game id so /j/:id can route
        // straight to the report instead of rendering a one-game story.
        ...(kind === 'single' ? { kind, gameId: games[0]?.id } : {}),
        status: 'analyzing',
        total: items.length,
        completed: 0,
        // Initial value, not a counter increment: games rejected at ingest
        // are counted here once and never touched by the completion path.
        failed: rejected,
        nodeBudget: cfg.nodeBudget,
        ring: [],
        agg: emptyPartialAgg(),
        createdAt: now.toISOString(),
        deadlineAt: deadline.toISOString(),
      },
    }),
  )

  type BatchItems = NonNullable<
    NonNullable<ConstructorParameters<typeof BatchWriteCommand>[0]>['RequestItems']
  >
  for (let i = 0; i < items.length; i += 25) {
    let batch: BatchItems = {
      [deps.table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
    }
    while (Object.keys(batch).length > 0) {
      const out = await deps.ddb.send(new BatchWriteCommand({ RequestItems: batch }))
      batch = out.UnprocessedItems ?? {}
      if (Object.keys(batch).length > 0) await new Promise((r) => setTimeout(r, 200))
    }
  }

  // Cache hits complete through THE transaction right now, without ever
  // touching the queue; misses are routed per game (container vs Lambda) and
  // enqueued in per-queue buckets.
  const pick = await makeRouter(deps, cfg)
  const toSend = new Map<string, string[]>() // queue URL -> game ids
  let hits = 0
  let enqueued = 0
  for (const item of items) {
    if (item.status !== 'pending') continue
    const record = await getEngineRecord(deps, item.cacheKey)
    if (!record) {
      const url = pick(item.uciMoves.length, item.nodeBudget)
      toSend.set(url, [...(toSend.get(url) ?? []), item.gameId])
      enqueued += 1
      continue
    }
    hits += 1
    const outcome = buildDoneOutcome(
      { gameId: item.gameId, uciMoves: item.uciMoves, userColor: item.userColor, game: item.game },
      record,
      0,
    )
    if ((await executeCompletion(deps, jobId, item.gameId, outcome)) === 'applied') {
      await tryFinalize(deps, jobId)
    }
  }
  for (const [queueUrl, gameIds] of toSend) {
    for (let i = 0; i < gameIds.length; i += 10) {
      await deps.sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: gameIds.slice(i, i + 10).map((gameId, j) => ({
            Id: String(j),
            MessageBody: JSON.stringify({ jobId, gameId }),
          })),
        }),
      )
    }
  }
  // A job with nothing pending (all cache hits or all rejects) finalizes now;
  // no completion transaction will ever run for it again.
  if (enqueued === 0) await tryFinalize(deps, jobId)

  if (username) {
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
  }

  await deps.ddb
    .send(
      new UpdateCommand({
        TableName: deps.table,
        Key: metricsKey(now.toISOString().slice(0, 10)),
        UpdateExpression: 'ADD jobsCreated :one, gamesIngested :g, cacheHits :h',
        ExpressionAttributeValues: { ':one': 1, ':g': items.length, ':h': hits },
      }),
    )
    .catch((e) => log('warn', 'metrics tick failed', { jobId, error: String(e) }))

  log('info', 'job created', { jobId, username, total: items.length, rejected, hits, enqueued })
}
