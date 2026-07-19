'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Board } from '../../../../components/Board'
import { BarChart, LineChart } from '../../../../components/charts'
import { SpotlightCard } from '../../../../components/bits/SpotlightCard'
import { copy, formatDate, phaseLabels } from '../../../../copy'
import { getJobOrNotFound, type JobView } from '../../../../lib/api'

// Panels below this many data points fall back to a .panel-empty state
// instead of a d3 chart nobody can read a trend out of (F2).
const MIN_CHART_POINTS = 3

// The analytics dashboard: 1080px grid, same tokens, d3 charts. Accuracy trend
// by month, blunder rate by ECO family and by phase, time-pressure buckets,
// most-repeated mistakes with mini-boards, and the full game list linking to
// per-game reports.
export default function Breakdown({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params)
  const [job, setJob] = useState<JobView | null>(null)
  // A real 404 — shown immediately, no retry (retrying a link that will
  // never resolve just delays the honest answer).
  const [missing, setMissing] = useState(false)
  // K7: a null (network hiccup, indistinguishable from a 404 without asking
  // again) gets one retry before it's treated as a real, distinct outage.
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let stop = false
    async function load() {
      for (let attempt = 0; attempt < 2; attempt++) {
        const j = await getJobOrNotFound(jobId)
        if (stop) return
        if (j === 'notFound') {
          setMissing(true)
          return
        }
        if (j) {
          setJob(j)
          return
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000))
        if (stop) return
      }
      setLoadFailed(true)
    }
    void load()
    return () => {
      stop = true
    }
  }, [jobId])

  if (loadFailed) return <main className="dash"><p className="quiet">{copy.outage.breakdown}</p></main>
  if (missing) return <main className="dash"><p className="quiet">{copy.progress.notFound}</p></main>
  if (!job) {
    return (
      <main className="dash" aria-busy="true">
        {/* F3: skeleton mirrors the real grid — a KPI-strip row of 4 plus
            4 chart panels plus 1 wide panel, not a generic 4-box guess. */}
        <div className="kpi-strip">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton-panel" style={{ height: 88 }} />
          ))}
        </div>
        <div className="dash-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton-panel" />
          ))}
          <div className="skeleton-panel panel-wide" />
        </div>
      </main>
    )
  }
  const w = job.wrapped
  if (!w) {
    return (
      <main className="dash">
        <p className="quiet">This analysis is not finished yet.</p>
        <Link href={`/j/${jobId}`}>Back to progress</Link>
      </main>
    )
  }

  // F1: KPI strip — all four are cheap derivations of `w`, already on the page.
  const totalBlunders = w.blunderRateByPhase.reduce((sum, p) => sum + p.blunders, 0)
  const worstPhase = w.blunderRateByPhase.reduce(
    (worst, p) => (worst === null || p.rate > worst.rate ? p : worst),
    null as (typeof w.blunderRateByPhase)[number] | null,
  )

  const monthData = w.accuracyByMonth.map((m) => ({ label: m.month, value: m.accuracy }))
  const familyData = w.blunderRateByFamily
    .filter((f) => f.moves >= 5)
    .slice(0, 8)
    .map((f) => ({ label: f.family, value: f.rate * 100 }))
  const phaseData = w.blunderRateByPhase.map((p) => ({ label: p.phase, value: p.rate * 100 }))
  // K8: buckets with no data (accuracy === null) are excluded outright —
  // they used to render as misleading 0.0% bars.
  const timeData = w.timePressure.buckets
    .filter((b) => b.accuracy !== null)
    .map((b) => ({ label: b.label, value: b.accuracy as number }))

  return (
    <main className="dash">
      <header className="dash-head">
        <h1 className="display" style={{ fontSize: '2rem', margin: 0 }}>
          {w.username ? `@${w.username}` : 'Your games'}, in full
        </h1>
        <Link href={`/j/${jobId}`}>Back to the story</Link>
      </header>

      <div className="kpi-strip">
        <Kpi label={copy.breakdown.kpiAccuracy} value={w.accuracy !== null ? `${w.accuracy.toFixed(1)}%` : '—'} />
        <Kpi label={copy.breakdown.kpiBlunders} value={String(totalBlunders)} />
        <Kpi label={copy.breakdown.kpiGames} value={String(w.totalGames)} />
        <Kpi
          label={copy.breakdown.kpiWorstPhase}
          value={worstPhase ? (phaseLabels[worstPhase.phase as keyof typeof phaseLabels] ?? worstPhase.phase) : '—'}
          context={worstPhase ? `${(worstPhase.rate * 100).toFixed(1)}% blunder rate` : undefined}
        />
      </div>

      <div className="dash-grid">
        <ChartPanel title="Accuracy by month" points={monthData.length} emptyValue={w.accuracy !== null ? `${w.accuracy.toFixed(1)}%` : null}>
          <LineChart data={monthData} />
        </ChartPanel>

        <ChartPanel
          title="Blunder rate by opening"
          points={familyData.length}
          emptyValue={familyData.length === 1 ? `${familyData[0].value.toFixed(1)}%` : null}
        >
          <BarChart data={familyData} />
        </ChartPanel>

        <ChartPanel title="Blunder rate by phase" points={phaseData.length}>
          <BarChart data={phaseData} />
        </ChartPanel>

        <ChartPanel
          title="Accuracy under time pressure"
          points={timeData.length}
          emptyValue={timeData.length === 1 ? `${timeData[0].value.toFixed(1)}%` : null}
        >
          <BarChart data={timeData} unit="%" />
        </ChartPanel>

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
                    <td className="quiet">{formatDate(g.date)}</td>
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
    <SpotlightCard className={`panel${wide ? ' panel-wide' : ''}`}>
      <h2 className="panel-title">{title}</h2>
      {children}
    </SpotlightCard>
  )
}

// F2: gates a chart Panel on having enough points for a trend to mean
// anything — below that, a single meaningful number (when there is one) or
// a plain "come back later" line, never a chart with one bar in it.
function ChartPanel({
  title,
  points,
  emptyValue,
  children,
}: {
  title: string
  points: number
  emptyValue?: string | null
  children: React.ReactNode
}) {
  return (
    <Panel title={title}>
      {points >= MIN_CHART_POINTS ? (
        children
      ) : (
        <div className="panel-empty">
          {emptyValue != null ? (
            <div className="mono" style={{ fontSize: 'var(--fs-stat)', fontWeight: 700 }}>{emptyValue}</div>
          ) : (
            <p className="quiet">{copy.breakdown.emptyChart(MIN_CHART_POINTS)}</p>
          )}
        </div>
      )}
    </Panel>
  )
}

function Kpi({ label, value, context }: { label: string; value: string; context?: string }) {
  return (
    <div className="panel kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value mono">{value}</div>
      {context && <div className="kpi-context">{context}</div>}
    </div>
  )
}
