'use client'

import { Fragment, use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BRAND_NAME } from '@forked/shared'
import { copy, formatDate, formatMonth } from '../../../copy'
import { getJob, getUserGames, postIngest, type GameRow } from '../../../lib/api'
import { GooeyNav } from '../../../components/bits/GooeyNav'
import { ShinyText } from '../../../components/bits/ShinyText'

type Row = GameRow & { month: string }
type ResultFilter = 'all' | 'w' | 'l'

// Browse mode: the whole game history as one newest-first list. The newest
// month renders instantly; older months load automatically on scroll, one
// fetch at a time. Analyze one game on demand from any row.
export default function Games({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params)
  const router = useRouter()
  const [months, setMonths] = useState<string[] | null>(null) // oldest first, null until first load
  const [rows, setRows] = useState<Row[]>([])
  const [nextIdx, setNextIdx] = useState(-1) // next older month to load, -1 = done
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  // Item 6: which of this user's games have been analyzed at least once —
  // nothing server-side records this, so it's a localStorage map read once
  // per username (never during render, or it'd run on the server). gameId ->
  // jobId; only the key's presence matters for the label, the jobId is kept
  // in case something wants it later.
  const [analyzed, setAnalyzed] = useState<Record<string, string>>({})
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    document.title = `${copy.browse.title(username)} | ${BRAND_NAME}`
  }, [username])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`forked:analyzed:${username.toLowerCase()}`)
      setAnalyzed(raw ? JSON.parse(raw) : {})
    } catch {
      // Private mode / quota errors must not break the list — just show
      // every row as unanalyzed.
      setAnalyzed({})
    }
  }, [username])

  useEffect(() => {
    let stop = false

    // Scroll restoration: analyze() stashes {rows, months, nextIdx, scrollY}
    // right before navigating to a report; restore it here instead of
    // re-fetching, then drop it — it's a one-shot cache for the Back button,
    // not a general one. Keyed lowercase: the report's Back link uses the
    // server-normalized (lowercased) username, which may differ in case from
    // the route the user browsed under. ponytail: no staleness handling
    // beyond that (a game analyzed elsewhere won't show until a refetch).
    const cacheKey = `games:${username.toLowerCase()}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      try {
        const saved = JSON.parse(cached) as { rows: Row[]; months: string[]; nextIdx: number; scrollY: number }
        // BUG5: validate the shape before applying it — a corrupt or
        // stale-schema cache entry should fall through to a real fetch, not
        // hand the page half-formed state.
        if (!Array.isArray(saved.rows) || !Array.isArray(saved.months) || !Number.isInteger(saved.nextIdx)) {
          throw new Error('bad cache shape')
        }
        setRows(saved.rows)
        setMonths(saved.months)
        setNextIdx(saved.nextIdx)
        setError(null)
        requestAnimationFrame(() => window.scrollTo(0, saved.scrollY))
        return
      } catch {
        // fall through to a normal fetch on a corrupt/old cache entry
      }
    }

    setMonths(null)
    setRows([])
    setNextIdx(-1)
    setError(null)
    getUserGames(username).then((res) => {
      if (stop) return
      if ('error' in res) {
        setError(copy.errors[res.error] ?? copy.errors.generic)
        return
      }
      setMonths(res.months)
      setRows(res.month ? res.games.map((g) => ({ ...g, month: res.month as string })) : [])
      setNextIdx(res.months.indexOf(res.month ?? '') - 1)
    })
    return () => {
      stop = true
    }
  }, [username])

  // BUG1: a failed fetch used to loop forever — the IO effect below recreates
  // its observer on every `loading` flip, the sentinel is still visible (the
  // failed month never advanced nextIdx), so it refires immediately and
  // retries into the same error. `force` is the manual "Load older" button's
  // way through: it clears the error and proceeds even though the guard
  // below would otherwise see it (the setError(null) the caller just fired
  // hasn't landed yet — state updates are async — so the guard can't rely on
  // reading the just-cleared value; force says "proceed anyway").
  async function loadOlder(force = false) {
    if (loading || nextIdx < 0 || !months) return
    if (error !== null && !force) return
    if (force) setError(null)
    setLoading(true)
    const m = months[nextIdx]
    const res = await getUserGames(username, m)
    setLoading(false)
    if ('error' in res) {
      setError(copy.errors[res.error] ?? copy.errors.generic)
      return
    }
    setRows((prev) => [...prev, ...res.games.map((g) => ({ ...g, month: m }))])
    setNextIdx((i) => i - 1)
  }

  // Fires loadOlder() once the sentinel scrolls into view; re-attaches
  // whenever the load state (or error) changes so an empty month keeps the
  // chain going, and a standing error stops it (BUG1).
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || nextIdx < 0) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadOlder()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [nextIdx, loading, months, username, error])

  async function analyze(row: Row) {
    if (busyId) return
    setBusyId(row.id)
    setError(null)
    const res = await postIngest({ username, gameId: row.id, month: row.month })
    if (!res.ok) {
      setBusyId(null)
      setError(copy.errors[res.code] ?? copy.errors.generic)
      return
    }
    if (res.joined) {
      // The per-username lock may have handed back a job for a different
      // game or the whole-archive flow; only follow it if it is really ours.
      const job = await getJob(res.jobId)
      if (job?.kind !== 'single' || job.gameId !== row.id) {
        setBusyId(null)
        setError(copy.errors.busy)
        return
      }
    }
    sessionStorage.setItem(
      `games:${username.toLowerCase()}`,
      JSON.stringify({ rows, months, nextIdx, scrollY: window.scrollY }),
    )
    // Item 6: remember this game was analyzed so a later visit to this list
    // shows "Review" instead of "Analyze" — try/catch for the same reason as
    // the read above (private mode / quota).
    try {
      const key = `forked:analyzed:${username.toLowerCase()}`
      const map = { ...JSON.parse(localStorage.getItem(key) ?? '{}'), [row.id]: res.jobId }
      localStorage.setItem(key, JSON.stringify(map))
    } catch {
      // Not critical — the click still works, it just won't say "Review" next time.
    }
    router.push(`/j/${res.jobId}/g/${row.id}`)
  }

  // B4: Won/Lost filter over the rows already loaded — no refetch, no
  // interaction with the infinite-scroll sentinel below.
  const filteredRows = resultFilter === 'all' ? rows : rows.filter((g) => resultLetter(g) === resultFilter)
  // B5: a sticky month header renders right before the first row of a new
  // month, computed off the FILTERED list so headers match what's on screen.
  const withMonthHeaders = filteredRows.map((g, i) => ({
    g,
    monthHeader: i === 0 || g.month !== filteredRows[i - 1].month ? g.month : null,
  }))

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

      {months === null && !error && (
        <div className="skeleton-list">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      )}
      {months !== null && months.length === 0 && <p className="quiet">{copy.browse.none}</p>}

      {months !== null && months.length > 0 && (
        <>
          {rows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <GooeyNav
                items={[
                  { label: copy.browse.filterAll, value: 'all' as const },
                  { label: copy.browse.won, value: 'w' as const },
                  { label: copy.browse.lost, value: 'l' as const },
                ]}
                active={resultFilter}
                onSelect={setResultFilter}
                ariaLabel="filter by result"
              />
            </div>
          )}

          {filteredRows.length > 0 && (
            // C4: no FadeContent wrapper — key={resultFilter} on the
            // table-scroll/game-cards containers directly remounts them (and
            // re-runs their row-stagger animation) on every filter change,
            // which is all the "entrance" this needs.
            <>
              <div className="table-scroll games-table-scroll" key={`table-${resultFilter}`}>
                <table className="game-table">
                  <thead>
                    <tr>
                      <th>{copy.browse.colDate}</th>
                      <th>{copy.browse.colOpponent}</th>
                      <th></th>
                      <th>{copy.browse.colOpening}</th>
                      <th className="num-col">{copy.browse.colLength}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {withMonthHeaders.map(({ g, monthHeader }) => {
                      const res = resultLetter(g)
                      const rating = opponentRating(g)
                      return (
                        <Fragment key={g.id}>
                          {monthHeader && (
                            <tr>
                              <td colSpan={6} className="month-divider">
                                {formatMonth(monthHeader)}
                              </td>
                            </tr>
                          )}
                          <tr
                            className={g.rejected ? undefined : `row-click${busyId === g.id ? ' coach-flash' : ''}`}
                            onClick={g.rejected ? undefined : () => analyze(g)}
                          >
                            <td className="mono quiet">{formatDate(g.date)}</td>
                            <td>
                              {opponent(g)}
                              {rating != null && <span className="quiet"> ({rating})</span>}
                            </td>
                            <td>
                              <ResChip r={res} /> <ColorDot color={g.userColor} />
                            </td>
                            <td className="quiet">{g.opening ?? '?'}</td>
                            <td className="mono quiet num-col">{Math.ceil(g.plies / 2)}</td>
                            <td>
                              {g.rejected ? (
                                <span className="quiet" title={g.rejected}>
                                  {'—'}
                                </span>
                              ) : (
                                <button
                                  className="row-analyze"
                                  disabled={busyId !== null}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void analyze(g)
                                  }}
                                >
                                  <AnalyzeLabel busy={busyId === g.id} done={g.id in analyzed} />
                                </button>
                              )}
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="game-cards" key={`cards-${resultFilter}`}>
                {withMonthHeaders.map(({ g, monthHeader }) => {
                  const res = resultLetter(g)
                  const rating = opponentRating(g)
                  const busy = busyId === g.id
                  return (
                    <Fragment key={g.id}>
                      {/* J8: a screen reader should hear the month it's
                          moving into — it was wrongly hidden before. */}
                      {monthHeader && (
                        <li className="month-divider-li">
                          {formatMonth(monthHeader)}
                        </li>
                      )}
                      <li>
                        <button
                          className="game-card"
                          disabled={g.rejected != null || busyId !== null}
                          onClick={() => analyze(g)}
                        >
                          <span className="game-card-row1">
                            <span>
                              {opponent(g)}
                              {rating != null && <span className="quiet"> ({rating})</span>}
                            </span>
                            {g.rejected ? (
                              <span className="quiet" title={g.rejected}>
                                {'—'}
                              </span>
                            ) : busy ? (
                              <span className="quiet">
                                <AnalyzeLabel busy done={g.id in analyzed} />
                              </span>
                            ) : (
                              <ResChip r={res} />
                            )}
                          </span>
                          <span className="game-card-row2 quiet">
                            <ColorDot color={g.userColor} />
                            <span>{formatDate(g.date)}</span>
                            <span>·</span>
                            <span className="game-card-opening">{g.opening ?? '?'}</span>
                            <span>·</span>
                            <span>{Math.ceil(g.plies / 2)} moves</span>
                          </span>
                        </button>
                      </li>
                    </Fragment>
                  )
                })}
              </ul>
            </>
          )}

          <div ref={sentinelRef}>
            {nextIdx >= 0 && (
              <button className="chip-button" disabled={loading} onClick={() => void loadOlder(true)}>
                {loading ? copy.browse.loading : copy.browse.loadOlder}
              </button>
            )}
            {rows.length === 0 && nextIdx < 0 && <p className="quiet">{copy.browse.empty}</p>}
            {rows.length > 0 && resultFilter === 'all' && nextIdx < 0 && (
              <p className="quiet">{copy.browse.endCount(rows.length)}</p>
            )}
            {rows.length > 0 && resultFilter !== 'all' && (
              <p className="quiet">{copy.browse.filteredCount(filteredRows.length, rows.length)}</p>
            )}
          </div>
        </>
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

function opponentRating(g: GameRow): number | null {
  return g.userColor === 'white' ? g.black.rating : g.white.rating
}

// Result pill: color AND words, so the outcome doesn't collapse for
// colorblind users the way a lone W/L letter did.
function ResChip({ r }: { r: 'w' | 'l' | 'd' | '?' }) {
  const text = r === 'w' ? copy.browse.won : r === 'l' ? copy.browse.lost : r === 'd' ? copy.browse.draw : '?'
  return <span className={`res-chip res-${r}`}>{text}</span>
}

// Small square showing which color the user played that game.
function ColorDot({ color }: { color: 'white' | 'black' | null }) {
  if (!color) return null
  const label = color === 'white' ? copy.browse.playedWhite : copy.browse.playedBlack
  return <span className={`color-dot color-dot-${color}`} title={label} aria-label={label} />
}

// The analyze button's label, shared by the table row and the mobile card:
// a spinner glyph in place of the idle text while this row's request is in
// flight; otherwise "Review" once this game has been analyzed before
// (item 6, the localStorage map above), "Analyze" if it hasn't.
function AnalyzeLabel({ busy, done }: { busy: boolean; done: boolean }) {
  if (!busy) return <>{done ? copy.browse.review : copy.browse.analyze}</>
  return (
    <>
      <span className="spin" aria-hidden>
        ◐
      </span>{' '}
      <ShinyText text={copy.browse.analyzing} speed={1.5} />
    </>
  )
}
