import type { EngineRecord, GameRecord } from '@forked/shared'

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

// Only the fields anything here actually reads. GET /job/:id still sends the
// counters, the ring and the partial aggregates — the completion transaction
// keeps writing them — but no surface has read them since the progress page
// went away, so typing them here would only be clutter.
export interface JobView {
  jobId: string
  username: string | null
  gameId: string | null
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
  username: string
  gameId: string
  month: string
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

// Unlike getGameReport, this collapses a real 404 and a network hiccup into
// the same null — both remaining callers (the games list and the review board)
// only want the username or the game id, and treat "couldn't tell" the same as
// "not there". The /j/[jobId] shim needs its own server-side fetch instead: it
// runs during SSR, where it wants a request timeout and explicit no-store.
export async function getJob(jobId: string): Promise<JobView | null> {
  try {
    const res = await fetch(`${API_BASE}/job/${jobId}`)
    if (!res.ok) return null
    return (await res.json()) as JobView
  } catch {
    return null
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
