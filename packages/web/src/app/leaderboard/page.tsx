import Link from 'next/link'
import { BRAND_NAME } from '@forked/shared'
import { RemoveMe } from '../../components/RemoveMe'
import { SpotlightCard } from '../../components/bits/SpotlightCard'
import { copy } from '../../copy'
import { getLeaderboard } from '../../lib/api'

export const metadata = { title: `leaderboard | ${BRAND_NAME}` }
export const dynamic = 'force-dynamic'

// Server component: one no-store fetch, zero client state. Only the opt-out
// form ships JavaScript.
export default async function Leaderboard() {
  const board = await getLeaderboard()
  // I9: board === null is a fetch outage, distinct from a real empty board
  // (board.users.length === 0) — the two used to share one "empty" copy.
  const outage = board === null

  return (
    <main className="dash">
      {/* D5: the landing page keeps the only ambient DotGrid field. */}
      <div className="dash-head">
        <h1 className="display" style={{ fontSize: '1.75rem', margin: 0 }}>
          {copy.leader.title}
        </h1>
        <Link href="/">{copy.leader.back}</Link>
      </div>

      <p className="quiet">{copy.leader.floorNote}</p>
      {outage ? (
        <p className="quiet">{copy.outage.leaderboard}</p>
      ) : board.users.length === 0 ? (
        <p className="quiet">{copy.leader.empty}</p>
      ) : (
        // C5: no FadeContent — this is the primary content of the page, not a
        // below-the-fold reveal.
        <>
        {/* Top-3 podium: the page is about ranking, so the top ranks get
            visual weight the table can't give them. H1: always 3 slots —
            an unfilled one is a ghost card, not a shorter grid. */}
        <div className="podium">
          {Array.from({ length: 3 }, (_, i) => board.users[i]).map((u, i) =>
            u ? (
              <SpotlightCard key={u.username} className="panel">
                <div className="podium-rank mono">#{i + 1}</div>
                <Link href={`/u/${encodeURIComponent(u.username)}`}>{u.username}</Link>
                <div className="podium-acc mono">
                  {u.accuracy.toFixed(1)}
                  <span style={{ fontSize: '0.6em', color: 'var(--muted)' }}>%</span>
                </div>
                <div className="quiet" style={{ fontSize: 13 }}>
                  {/* B9: mark is muted, not the red accent-text. */}
                  {u.archetype.name} <span className="mono" style={{ color: 'var(--muted)' }}>{u.archetype.mark}</span>
                </div>
              </SpotlightCard>
            ) : (
              <Link key={`ghost-${i}`} href="/" className="panel podium-ghost">
                <div className="podium-rank mono">{copy.leader.podiumGhost(i + 1)}</div>
                <div className="quiet">{copy.leader.podiumGhostCta}</div>
              </Link>
            ),
          )}
        </div>
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
                  {/* Name first, mark after (matches Card.tsx/Story.tsx): a
                      leading "!"/"??" glyph before the name read like a typo.
                      B9: mark is muted, not the red accent-text. */}
                  {u.archetype.name} <span className="mono" style={{ color: 'var(--muted)' }}>{u.archetype.mark}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </>
      )}
      {!outage && board.users.length > 0 && <p className="quiet">{copy.leader.archetypeNote}</p>}

      {/* C5: no FadeContent — always-visible utility section, not a reveal. */}
      <section style={{ marginTop: '2rem' }}>
        <p className="panel-title">{copy.leader.removeTitle}</p>
        <p className="quiet">{copy.leader.removeNote}</p>
        <RemoveMe />
      </section>
    </main>
  )
}
