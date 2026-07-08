import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { archiveKey, parseGamePgn, type ParsedGame } from '@forked/shared'
import type { Deps } from '@forked/worker'

export class UserNotFoundError extends Error {
  constructor(username: string) {
    super(`chess.com user not found: ${username}`)
    this.name = 'UserNotFoundError'
  }
}

// One archive game in the compact form we cache: either a parsed game or the
// reason it was rejected at ingest. Far smaller than the raw PGN, which is
// what keeps a whole month inside one DynamoDB item.
export interface ArchiveGame {
  id: string
  endTime: number // epoch seconds from chess.com, UTC
  game: ParsedGame | null
  rejection: { code: string; message: string } | null
}

interface ChessComGame {
  url?: string
  uuid?: string
  pgn?: string
  rules?: string
  end_time?: number
}

const API = 'https://api.chess.com/pub'

export type ChessCom = ReturnType<typeof makeChessCom>

export function makeChessCom(
  deps: Deps,
  opts: { contactEmail: string; fetchFn?: typeof fetch },
) {
  const fetchFn = opts.fetchFn ?? fetch
  const headers = {
    'User-Agent': `forked/0.1 (open-source chess analysis; contact ${opts.contactEmail})`,
  }

  // chess.com etiquette: serial requests only, never parallel. Every API call
  // runs through this gate, so callers cannot misbehave even with Promise.all.
  let chain: Promise<unknown> = Promise.resolve()
  function getJson(url: string, username: string): Promise<unknown> {
    const next = chain.then(
      async () => {
        const res = await fetchFn(url, { headers })
        if (res.status === 404) throw new UserNotFoundError(username)
        if (!res.ok) throw new Error(`chess.com responded ${res.status} for ${url}`)
        return res.json()
      },
    )
    chain = next.catch(() => {})
    return next
  }

  return {
    // Months the user has games in, oldest first, as 'YYYY-MM'.
    // Usernames are regex-validated at every route, but encode anyway so no
    // future caller can splice a path into the upstream URL.
    async listMonths(username: string): Promise<string[]> {
      const data = (await getJson(
        `${API}/player/${encodeURIComponent(username)}/games/archives`,
        username,
      )) as {
        archives?: string[]
      }
      return (data.archives ?? []).flatMap((u) => {
        const m = /\/(\d{4})\/(\d{2})$/.exec(u)
        return m ? [`${m[1]}-${m[2]}`] : []
      })
    },

    // Completed months are immutable, so they are cached permanently in
    // DynamoDB; only the current, still-in-progress UTC month is ever fetched
    // fresh (and never cached).
    async monthGames(username: string, month: string): Promise<ArchiveGame[]> {
      const currentMonth = new Date().toISOString().slice(0, 7)
      const key = archiveKey(username, month)
      if (month < currentMonth) {
        const hit = await deps.ddb.send(new GetCommand({ TableName: deps.table, Key: key }))
        if (hit.Item) return hit.Item.games as ArchiveGame[]
      }
      const [y, m] = month.split('-')
      const data = (await getJson(
        `${API}/player/${encodeURIComponent(username)}/games/${y}/${m}`,
        username,
      )) as {
        games?: ChessComGame[]
      }
      const games = (data.games ?? []).map(toArchiveGame)
      if (month < currentMonth) {
        const item = { ...key, games, cachedAt: new Date().toISOString() }
        // ponytail: a month whose compact form still exceeds the 400KB item
        // limit is simply not cached; chunked month items if that ever matters.
        if (JSON.stringify(item).length < 380_000) {
          await deps.ddb.send(new PutCommand({ TableName: deps.table, Item: item }))
        }
      }
      return games
    },
  }
}

function toArchiveGame(g: ChessComGame): ArchiveGame {
  const id = g.uuid ?? g.url?.split('/').pop() ?? 'unknown'
  const endTime = g.end_time ?? 0
  if (g.rules && g.rules !== 'chess') {
    return {
      id,
      endTime,
      game: null,
      rejection: { code: 'variant', message: `Variant games (${g.rules}) are not supported.` },
    }
  }
  if (!g.pgn) {
    return { id, endTime, game: null, rejection: { code: 'empty', message: 'Game has no PGN.' } }
  }
  const parsed = parseGamePgn(g.pgn)
  if (!parsed.ok) {
    return { id, endTime, game: null, rejection: { code: parsed.code, message: parsed.message } }
  }
  return { id, endTime, game: parsed, rejection: null }
}
