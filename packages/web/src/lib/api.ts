import type { EngineRecord, GameRecord, WrappedSummary } from '@forked/shared'

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'
export type { WrappedSummary } from '@forked/shared'

export interface RingEntryView {
  gameId: string
  accuracy: number | null
  finishedAt: string
  opp: string
  res: 'w' | 'l' | 'd' | '?'
  plies: number
}

export interface PartialAgg {
  accSum: number
  accCnt: number
  opb: Record<string, number>
  opm: Record<string, number>
  phb: Record<string, number>
  phm: Record<string, number>
}

export interface JobView {
  jobId: string
  username: string | null
  kind: 'archive' | 'single'
  gameId: string | null
  status: 'ingesting' | 'analyzing' | 'finalizing' | 'complete' | 'failed'
  total: number
  completed: number
  failed: number
  ring: RingEntryView[]
  agg: PartialAgg
  createdAt: string
  wrapped: WrappedSummary | null
  failures?: { gameId: string; error: string | null }[]
}

export interface GameReport {
  gameId: string
  userColor: 'white' | 'black' | null
  status: string
  game: GameRecord
  record: EngineRecord | null
}

export async function getGameReport(jobId: string, gameId: string): Promise<GameReport | null> {
  const res = await fetch(`${API_BASE}/job/${jobId}/game/${gameId}`)
  if (!res.ok) return null
  return (await res.json()) as GameReport
}

export interface IngestOk {
  ok: true
  jobId: string
  joined: boolean
}

export interface IngestErr {
  ok: false
  code: string
}

export interface GameRow {
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

export interface UserGames {
  username: string
  months: string[]
  month: string | null
  games: GameRow[]
}

export async function getUserGames(
  username: string,
  month?: string,
): Promise<UserGames | { error: string }> {
  try {
    const res = await fetch(
      `${API_BASE}/games/${encodeURIComponent(username)}${month ? `?month=${month}` : ''}`,
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      return { error: body.code ?? 'generic' }
    }
    return (await res.json()) as UserGames
  } catch {
    return { error: 'generic' }
  }
}

export async function postIngest(body: {
  username?: string
  pgn?: string
  from?: string
  to?: string
  gameId?: string
  month?: string
}): Promise<IngestOk | IngestErr> {
  try {
    const res = await fetch(`${API_BASE}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as IngestOk | IngestErr
  } catch {
    return { ok: false, code: 'generic' }
  }
}

export async function getJob(jobId: string, failures = false): Promise<JobView | null> {
  const res = await fetch(`${API_BASE}/job/${jobId}${failures ? '?failures=1' : ''}`)
  if (!res.ok) return null
  return (await res.json()) as JobView
}

export interface LeaderUser {
  username: string
  accuracy: number
  games: number
  archetype: { key: string; name: string; mark: string }
}

export interface LeaderBlunder {
  username: string
  jobId: string
  gameId: string
  opponent: string
  move: string
  ply: number
  lossPct: number
  fen: string
  cliff: number[]
}

export interface Leaderboard {
  users: LeaderUser[]
  blunder: LeaderBlunder | null
}

export async function getLeaderboard(): Promise<Leaderboard | null> {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Leaderboard
  } catch {
    return null
  }
}

export async function postLeaderboardRemove(username: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/leaderboard/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getPositionsJudged(): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/metrics`)
    if (!res.ok) return null
    const data = (await res.json()) as { positions: number }
    return data.positions
  } catch {
    return null
  }
}
