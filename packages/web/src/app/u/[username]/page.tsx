'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { copy } from '../../../copy'
import { getUserGames, postIngest, type GameRow, type UserGames } from '../../../lib/api'

// Browse mode: pull the user's games one month at a time and analyze a single
// game on demand. A tool alongside the whole-archive Wrapped flow, not a story.
export default function Games({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params)
  const router = useRouter()
  const [data, setData] = useState<UserGames | null>(null)
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    setData(null)
    setError(null)
    getUserGames(username, month).then((res) => {
      if (stop) return
      if ('error' in res) setError(copy.errors[res.error] ?? copy.errors.generic)
      else setData(res)
    })
    return () => {
      stop = true
    }
  }, [username, month])

  async function analyze(row: GameRow) {
    if (busyId || !data?.month) return
    setBusyId(row.id)
    setError(null)
    const res = await postIngest({ username, gameId: row.id, month: data.month })
    if (res.ok) {
      router.push(`/j/${res.jobId}/g/${row.id}`)
      return
    }
    setBusyId(null)
    setError(copy.errors[res.code] ?? copy.errors.generic)
  }

  const idx = data ? data.months.indexOf(data.month ?? '') : -1

  return (
    <main className="dash">
      <div className="dash-head">
        <h1 className="display" style={{ fontSize: '1.75rem', margin: 0 }}>
          {copy.browse.title(username)}
        </h1>
        <Link href="/">{copy.browse.back}</Link>
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {data && data.months.length > 0 && (
        <div className="month-nav">
          <button
            className="chip-button"
            disabled={idx <= 0}
            onClick={() => setMonth(data.months[idx - 1])}
          >
            {copy.browse.older}
          </button>
          <span className="current mono">{data.month}</span>
          <button
            className="chip-button"
            disabled={idx < 0 || idx >= data.months.length - 1}
            onClick={() => setMonth(data.months[idx + 1])}
          >
            {copy.browse.newer}
          </button>
        </div>
      )}

      {!data && !error && <p className="quiet">{copy.browse.loading}</p>}
      {data && data.months.length === 0 && <p className="quiet">{copy.browse.none}</p>}
      {data && data.months.length > 0 && data.games.length === 0 && (
        <p className="quiet">{copy.browse.empty}</p>
      )}

      {data && data.games.length > 0 && (
        <div className="table-scroll">
        <table className="game-table">
          <thead>
            <tr>
              <th>{copy.browse.colDate}</th>
              <th>{copy.browse.colOpponent}</th>
              <th></th>
              <th>{copy.browse.colOpening}</th>
              <th>{copy.browse.colLength}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.games.map((g) => {
              const res = resultLetter(g)
              return (
                <tr key={g.id}>
                  <td className="mono quiet">{g.date ?? '?'}</td>
                  <td>{opponent(g)}</td>
                  <td className={`mono res-${res === '?' ? 'q' : res}`}>{res.toUpperCase()}</td>
                  <td className="quiet">{g.opening ?? '?'}</td>
                  <td className="mono quiet">{Math.ceil(g.plies / 2)}</td>
                  <td>
                    {g.rejected ? (
                      <span className="quiet" title={g.rejected}>
                        {'—'}
                      </span>
                    ) : (
                      <button
                        className="row-analyze"
                        disabled={busyId !== null}
                        onClick={() => analyze(g)}
                      >
                        {busyId === g.id ? copy.browse.analyzing : copy.browse.analyze}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </main>
  )
}

// Result from the user's perspective; '?' when the game is unfinished or the
// user is not a named player (should not happen for a real archive).
function resultLetter(g: GameRow): 'w' | 'l' | 'd' | '?' {
  if (g.result === '1/2-1/2') return 'd'
  if (!g.userColor || (g.result !== '1-0' && g.result !== '0-1')) return '?'
  const won = (g.result === '1-0') === (g.userColor === 'white')
  return won ? 'w' : 'l'
}

function opponent(g: GameRow): string {
  return g.userColor === 'white' ? g.black.name : g.white.name
}
