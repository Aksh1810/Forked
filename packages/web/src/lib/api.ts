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
  // Cheap observed-throughput projection (control/status.ts); null when the
  // job isn't analyzing yet or there's no rate to project from.
  etaSeconds: number | null
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

// 'notFound' is a distinct sentinel from null: null is "couldn't ask" (network
// error), 'notFound' is "asked, and there is definitely no such game" — the
// /j/<jobId>/g/<gameId> report page uses that distinction to give up instead
// of polling a bad id pair forever (see QA2).
export async function getGameReport(jobId: string, gameId: string): Promise<GameReport | 'notFound' | null> {
  try {
    const res = await fetch(`${API_BASE}/job/${jobId}/game/${gameId}`)
    if (res.status === 404) return 'notFound'
    if (!res.ok) return null
    return (await res.json()) as GameReport
  } catch {
    return null
  }
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

// K7: same 'notFound' vs null distinction as getGameReport above — a plain
// getJob() collapses a real 404 and a network hiccup into the same null,
// which the breakdown page needs to tell apart (a genuinely bad link vs
// "try again"). This is the one fetcher for the endpoint; getJob is a
// convenience view over it.
export async function getJobOrNotFound(
  jobId: string,
  failures = false,
): Promise<JobView | 'notFound' | null> {
  try {
    const res = await fetch(`${API_BASE}/job/${jobId}${failures ? '?failures=1' : ''}`)
    if (res.status === 404) return 'notFound'
    if (!res.ok) return null
    return (await res.json()) as JobView
  } catch {
    return null
  }
}

export async function getJob(jobId: string, failures = false): Promise<JobView | null> {
  const r = await getJobOrNotFound(jobId, failures)
  return r === 'notFound' ? null : r
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
