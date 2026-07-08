import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { cacheItemKey, gameKey, jobKey } from '@forked/shared'
import type { Deps } from '@forked/worker'
import type { ArchiveGame, ChessCom } from './chesscom.js'

// Public job view for the progress page. The partial-aggregate object rides
// along so the teaser slot has real data to draw from once Phase 4 turns it
// on; nothing secret lives on a job item anyway (results are public by link).
export async function getJobView(
  deps: Deps,
  jobId: string,
  includeFailures: boolean,
): Promise<Record<string, unknown> | null> {
  const out = await deps.ddb.send(new GetCommand({ TableName: deps.table, Key: jobKey(jobId) }))
  const j = out.Item
  if (!j) return null
  const view: Record<string, unknown> = {
    jobId: j.jobId,
    username: j.username,
    kind: j.kind ?? 'archive',
    gameId: j.gameId ?? null,
    status: j.status,
    total: j.total,
    completed: j.completed,
    failed: j.failed,
    ring: j.ring,
    agg: j.agg,
    createdAt: j.createdAt,
    // Present once finalized; the single read model for story, cards, and OG.
    wrapped: j.wrapped ?? null,
  }
  if (includeFailures) {
    // Fetched once by the client when the job settles, not on every poll.
    const games = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :g)',
        FilterExpression: '#st = :failed',
        ExpressionAttributeNames: { '#st': 'status', '#err': 'error' },
        ExpressionAttributeValues: { ':pk': `JOB#${jobId}`, ':g': 'GAME#', ':failed': 'failed' },
        ProjectionExpression: 'gameId, #err',
      }),
    )
    view.failures = (games.Items ?? []).map((g) => ({ gameId: g.gameId, error: g.error ?? null }))
  }
  return view
}

// The browse list: one month of a user's games as metadata only, no analysis.
// Reads straight from the per-month archive cache (chesscom.monthGames), so
// paging months is cheap. Defaults to the most recent month. Throws
// UserNotFoundError (surfaced as 404 by the route) when the user has no archive.
export interface GameListRow {
  id: string
  endTime: number
  date: string | null
  white: { name: string; rating: number | null }
  black: { name: string; rating: number | null }
  result: string
  opening: string | null
  timeControl: string
  plies: number
  userColor: 'white' | 'black' | null
  rejected: string | null
}

export async function getUserGames(
  chesscom: ChessCom,
  username: string,
  month?: string,
): Promise<{ username: string; months: string[]; month: string | null; games: GameListRow[] }> {
  const uname = username.toLowerCase()
  const months = await chesscom.listMonths(uname) // oldest first
  if (months.length === 0) return { username: uname, months, month: null, games: [] }
  const picked = month && months.includes(month) ? month : months[months.length - 1]
  const games = (await chesscom.monthGames(uname, picked)).map((g) => toRow(g, uname))
  // Newest game first within the month.
  games.sort((a, b) => b.endTime - a.endTime)
  return { username: uname, months, month: picked, games }
}

function toRow(g: ArchiveGame, uname: string): GameListRow {
  const p = g.game
  // Finish date (from end_time), so the column is monotonic with the newest-first
  // sort and matches how chess.com groups a month; PGN date only as a fallback.
  const date = g.endTime ? new Date(g.endTime * 1000).toISOString().slice(0, 10) : (p?.date ?? null)
  const userColor =
    p && p.white.name.toLowerCase() === uname
      ? 'white'
      : p && p.black.name.toLowerCase() === uname
        ? 'black'
        : null
  return {
    id: g.id,
    endTime: g.endTime,
    date,
    white: p?.white ?? { name: '?', rating: null },
    black: p?.black ?? { name: '?', rating: null },
    result: p?.result ?? '*',
    opening: p?.openingName ?? p?.eco ?? null,
    timeControl: p?.timeControl ?? '?',
    plies: p?.uciMoves.length ?? 0,
    userColor,
    rejected: p ? null : (g.rejection?.message ?? 'Unsupported game.'),
  }
}

// Per-game report: the game record joined with its engine record (eval series,
// classifications, best moves). All time-pressure data comes from the game
// record's clocks, never the shared engine record. Returns null if the game or
// its engine record is missing.
export async function getGameReport(
  deps: Deps,
  jobId: string,
  gameId: string,
): Promise<Record<string, unknown> | null> {
  const g = (await deps.ddb.send(new GetCommand({ TableName: deps.table, Key: gameKey(jobId, gameId) }))).Item
  if (!g) return null
  const cache = (
    await deps.ddb.send(new GetCommand({ TableName: deps.table, Key: cacheItemKey(g.cacheKey as string) }))
  ).Item
  return {
    gameId,
    userColor: g.userColor ?? null,
    status: g.status,
    game: g.game,
    record: cache?.record ?? null,
  }
}
