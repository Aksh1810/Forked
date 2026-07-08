'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Board } from '../../../../components/Board'
import { BarChart, LineChart } from '../../../../components/charts'
import { getJob, type JobView } from '../../../../lib/api'

// The analytics dashboard: 1080px grid, same tokens, d3 charts. Accuracy trend
// by month, blunder rate by ECO family and by phase, time-pressure buckets,
// most-repeated mistakes with mini-boards, and the full game list linking to
// per-game reports.
export default function Breakdown({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params)
  const [job, setJob] = useState<JobView | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    getJob(jobId)
      .then((j) => (j ? setJob(j) : setMissing(true)))
      .catch(() => setMissing(true))
  }, [jobId])

  if (missing) return <main className="dash"><p className="quiet">No analysis lives at this link.</p></main>
  if (!job) return <main className="dash" aria-busy="true" />
  const w = job.wrapped
  if (!w) {
    return (
      <main className="dash">
        <p className="quiet">This analysis is not finished yet.</p>
        <Link href={`/j/${jobId}`}>Back to progress</Link>
      </main>
    )
  }

  return (
    <main className="dash">
      <header className="dash-head">
        <h1 className="display" style={{ fontSize: '2rem', margin: 0 }}>
          {w.username ? `@${w.username}` : 'Your games'}, in full
        </h1>
        <Link href={`/j/${jobId}`}>Back to the story</Link>
      </header>

      <div className="dash-grid">
        <Panel title="Accuracy by month">
          <LineChart data={w.accuracyByMonth.map((m) => ({ label: m.month, value: m.accuracy }))} />
        </Panel>

        <Panel title="Blunder rate by opening">
          <BarChart
            data={w.blunderRateByFamily
              .filter((f) => f.moves >= 5)
              .slice(0, 8)
              .map((f) => ({ label: f.family, value: f.rate * 100 }))}
          />
        </Panel>

        <Panel title="Blunder rate by phase">
          <BarChart data={w.blunderRateByPhase.map((p) => ({ label: p.phase, value: p.rate * 100 }))} />
        </Panel>

        <Panel title="Accuracy under time pressure">
          <BarChart
            data={w.timePressure.buckets.map((b) => ({ label: b.label, value: b.accuracy ?? 0 }))}
            unit="%"
          />
        </Panel>

        {w.repeatedMistakes.length > 0 && (
          <Panel title="Most-repeated mistakes" wide>
            <div className="mistake-row">
              {w.repeatedMistakes.map((mm) => (
                <div key={`${mm.ply}-${mm.move}`} className="mistake-card">
                  <Board fen={mm.fen} size={130} alt={`repeated mistake ${mm.move}`} />
                  <div className="mono quiet">
                    {mm.move} ×{mm.count}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title={`All games (${w.games.length})`} wide>
          <div style={{ overflowX: 'auto' }}>
            <table className="game-table mono">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Result</th>
                  <th>Accuracy</th>
                  <th>Worst</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {w.games.map((g) => (
                  <tr key={g.gameId}>
                    <td className="quiet">{g.date ?? '--'}</td>
                    <td>{g.opponent}</td>
                    <td className={`res-${g.result === '?' ? 'q' : g.result}`}>{g.result.toUpperCase()}</td>
                    <td>{g.accuracy !== null ? g.accuracy.toFixed(1) : '--'}</td>
                    <td className="quiet">{g.worstMove ?? '--'}</td>
                    <td>
                      <Link href={`/j/${jobId}/g/${g.gameId}`}>report</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </main>
  )
}

function Panel({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`panel${wide ? ' panel-wide' : ''}`}>
      <h2 className="panel-title">{title}</h2>
      {children}
    </section>
  )
}
