import Link from 'next/link'
import { BRAND_NAME } from '@forked/shared'
import { Board } from '../../components/Board'
import { EvalCliff } from '../../components/EvalCliff'
import { RemoveMe } from '../../components/RemoveMe'
import { copy } from '../../copy'
import { getLeaderboard } from '../../lib/api'

export const metadata = { title: `leaderboard | ${BRAND_NAME}` }
export const dynamic = 'force-dynamic'

// Server component: one no-store fetch, tabs are plain links, zero client
// state. Only the opt-out form ships JavaScript.
export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const blunderTab = tab === 'blunder'
  const board = await getLeaderboard()

  return (
    <main className="dash">
      <div className="dash-head">
        <h1 className="display" style={{ fontSize: '1.75rem', margin: 0 }}>
          {copy.leader.title}
        </h1>
        <Link href="/">{copy.leader.back}</Link>
      </div>

      <nav className="tab-row">
        <Link href="/leaderboard" className="chip-button" aria-current={!blunderTab ? 'page' : undefined}>
          {copy.leader.tabAccuracy}
        </Link>
        <Link
          href="/leaderboard?tab=blunder"
          className="chip-button"
          aria-current={blunderTab ? 'page' : undefined}
        >
          {copy.leader.tabBlunder}
        </Link>
      </nav>

      {!blunderTab && (
        <>
          <p className="quiet">{copy.leader.floorNote}</p>
          {!board || board.users.length === 0 ? (
            <p className="quiet">{copy.leader.empty}</p>
          ) : (
            <div className="table-scroll">
            <table className="game-table">
              <thead>
                <tr>
                  <th>{copy.leader.colRank}</th>
                  <th>{copy.leader.colPlayer}</th>
                  <th>{copy.leader.colAccuracy}</th>
                  <th>{copy.leader.colGames}</th>
                  <th>{copy.leader.colArchetype}</th>
                </tr>
              </thead>
              <tbody>
                {board.users.map((u, i) => (
                  <tr key={u.username}>
                    <td className="mono quiet">{i + 1}</td>
                    <td>
                      <Link href={`/u/${encodeURIComponent(u.username)}`}>{u.username}</Link>
                    </td>
                    <td className="mono">{u.accuracy.toFixed(1)}%</td>
                    <td className="mono quiet">{u.games}</td>
                    <td className="quiet">
                      <span className="mono">{u.archetype.mark}</span> {u.archetype.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}

      {blunderTab &&
        (!board?.blunder ? (
          <p className="quiet">{copy.leader.emptyBlunder}</p>
        ) : (
          <section className="panel" style={{ maxWidth: 480 }}>
            <p className="panel-title">{copy.leader.blunderBy(board.blunder.username)}</p>
            <p>
              {copy.leader.blunderLine(
                board.blunder.move,
                board.blunder.lossPct,
                board.blunder.opponent,
              )}
            </p>
            <Board fen={board.blunder.fen} alt={`position after ${board.blunder.move}`} />
            {board.blunder.cliff.length > 1 && <EvalCliff series={board.blunder.cliff} />}
          </section>
        ))}

      <section style={{ marginTop: '2rem' }}>
        <p className="panel-title">{copy.leader.removeTitle}</p>
        <p className="quiet">{copy.leader.removeNote}</p>
        <RemoveMe />
      </section>
    </main>
  )
}
