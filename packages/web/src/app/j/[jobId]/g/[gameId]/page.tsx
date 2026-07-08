'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { EvalGraph, MoveDetail, MoveList } from '../../../../../components/EvalGraph'
import { copy } from '../../../../../copy'
import { getGameReport, getJob, type GameReport } from '../../../../../lib/api'

// The per-game report: a tool, not a story. Eval graph in White's perspective
// with classification dots always visible and tappable, the move list in mono
// with chips, played-vs-best on any ply, and a clock overlay toggle. Polls
// until the engine record lands, so a just-requested single-game analysis
// resolves in place instead of showing "no analysis".
export default function Report({ params }: { params: Promise<{ jobId: string; gameId: string }> }) {
  const { jobId, gameId } = use(params)
  const [report, setReport] = useState<GameReport | null>(null)
  const [missing, setMissing] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [showClocks, setShowClocks] = useState(false)
  const [backHref, setBackHref] = useState(`/j/${jobId}/breakdown`)

  // Back to the games list when this game was analyzed on its own.
  useEffect(() => {
    let stop = false
    getJob(jobId).then((j) => {
      if (!stop && j?.kind === 'single' && j.username) setBackHref(`/u/${j.username}`)
    })
    return () => {
      stop = true
    }
  }, [jobId])

  useEffect(() => {
    let stop = false
    const iv = setInterval(tick, 1500)
    void tick()
    async function tick() {
      const r = await getGameReport(jobId, gameId).catch(() => null)
      if (stop) return
      if (r?.record) {
        setReport(r)
        clearInterval(iv)
      } else if (r && r.status === 'failed') {
        setMissing(true)
        clearInterval(iv)
      }
    }
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [jobId, gameId])

  if (missing) return <main className="flow"><p className="quiet">{copy.browse.noAnalysis}</p></main>
  if (!report?.record) {
    return (
      <main className="flow" aria-busy="true">
        <p className="status-line">{copy.browse.analyzingGame}</p>
      </main>
    )
  }
  const { game, record } = report

  return (
    <main className="flow report">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="display" style={{ fontSize: '1.5rem', margin: 0 }}>
          {game.white.name} vs {game.black.name}
        </h1>
        <Link href={backHref}>{copy.browse.back}</Link>
      </header>
      <p className="quiet mono">
        {game.result} · {game.date ?? 'unknown date'} · {game.openingName ?? game.eco ?? 'unknown opening'}
      </p>

      <EvalGraph record={record} selected={selected} onSelect={setSelected} />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0' }}>
        <button className="chip-button" onClick={() => setShowClocks((v) => !v)} aria-pressed={showClocks}>
          {showClocks ? 'Hide clocks' : 'Show clocks'}
        </button>
        {selected !== null && showClocks && game.clocks[selected - 1] != null && (
          <span className="mono quiet">clock: {formatClock(game.clocks[selected - 1] as number)}</span>
        )}
      </div>

      {selected !== null && <MoveDetail record={record} ply={selected} />}

      <MoveList record={record} selected={selected} onSelect={setSelected} />
    </main>
  )
}

function formatClock(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
