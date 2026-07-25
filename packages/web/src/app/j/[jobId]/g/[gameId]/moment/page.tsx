'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { momentFor, sanMoves, type Eval, type Moment } from '@forked/shared'
import { getGameReport, type GameReport } from '../../../../../../lib/api'
import { copy } from '../../../../../../copy'
import { Board } from '../../../../../../components/Board'
import { EvalBar } from '../../../../../../components/EvalBar'
import { EvalCliff } from '../../../../../../components/EvalCliff'
import { usePrefersReducedMotion } from '../../../../../../components/bits/reducedMotion'

// The five beats. Reduced motion jumps straight to the last (composed) beat.
// calm -> blunder played -> the crash -> the refutation -> roast + CTAs.
const BEAT_TIMES = [0, 1000, 2200, 3800, 5400]

export default function MomentPage({
  params,
}: {
  params: Promise<{ jobId: string; gameId: string }>
}) {
  const { jobId, gameId } = use(params)
  const [report, setReport] = useState<GameReport | 'notFound' | null>(null)

  useEffect(() => {
    let stop = false
    getGameReport(jobId, gameId).then((r) => {
      if (!stop) setReport(r)
    })
    return () => {
      stop = true
    }
  }, [jobId, gameId])

  if (report === null) {
    return (
      <main className="flow">
        <p className="quiet mono">Loading…</p>
      </main>
    )
  }

  const record = report !== 'notFound' ? report.record : null
  const side = report !== 'notFound' ? report.userColor : null
  const moment = record && side ? momentFor(record, side) : null

  if (report === 'notFound' || !record || !side || !moment) {
    return (
      <main className="flow">
        <p className="sub">{copy.coach.moment.noMoment}</p>
        <Link className="link-button" href={`/j/${jobId}/g/${gameId}`}>
          {copy.coach.moment.backToGame}
        </Link>
      </main>
    )
  }

  return <MomentReel jobId={jobId} gameId={gameId} record={record} side={side} moment={moment} report={report} />
}

function MomentReel({
  jobId,
  gameId,
  record,
  side,
  moment,
  report,
}: {
  jobId: string
  gameId: string
  record: NonNullable<GameReport['record']>
  side: 'white' | 'black'
  moment: Moment
  report: Exclude<GameReport, never>
}) {
  const reduced = usePrefersReducedMotion()
  const [beat, setBeat] = useState(0)
  const [copied, setCopied] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (reduced) {
      setBeat(BEAT_TIMES.length - 1)
      return
    }
    setBeat(0)
    BEAT_TIMES.forEach((t, i) => {
      if (i === 0) return
      timers.current.push(setTimeout(() => setBeat(i), t))
    })
  }, [reduced])

  useEffect(() => {
    play()
    return () => timers.current.forEach(clearTimeout)
  }, [play])

  const flip = side === 'black'
  const c = copy.coach.moment
  const opponent = side === 'white' ? report.game.black.name : report.game.white.name
  const lost = (side === 'white' && report.game.result === '0-1') || (side === 'black' && report.game.result === '1-0')

  // SANs for the captions.
  const playedSan = sanMoves(record.uciMoves)[moment.ply - 1] ?? moment.playedUci
  const bestSan = sanMoves([moment.bestUci], record.uciMoves.slice(0, moment.ply - 1))[0] ?? moment.bestUci
  const moveNum = Math.ceil(moment.ply / 2)
  const roast = c.roasts[moment.ply % c.roasts.length]

  // Eval shown on the bar, per beat: the healthy position before the move, the
  // wreckage after it.
  const beforeEval: Eval = moment.ply >= 2 ? record.plies[moment.ply - 2].evalAfter ?? record.startEval : record.startEval
  const afterEval: Eval = record.plies[moment.ply - 1].evalAfter ?? beforeEval

  // Board state per beat.
  const played = { from: moment.playedUci.slice(0, 2), to: moment.playedUci.slice(2, 4) }
  const bestArrow = { from: moment.bestUci.slice(0, 2), to: moment.bestUci.slice(2, 4), color: 'var(--best)' }

  const showCrash = beat >= 2
  const showRefute = beat >= 3
  const showRoast = beat >= 4

  const fen = beat === 0 ? moment.fenBefore : showRefute && moment.fenRefuted ? moment.fenRefuted : moment.fenAfter
  const ev: Eval = beat === 0 ? beforeEval : afterEval
  const lastMove = beat >= 1 && !showRefute ? played : undefined
  const arrows = showRefute ? [bestArrow] : undefined
  const badge = showCrash && !showRefute ? ({ square: played.to, kind: 'blunder' } as const) : undefined

  const caption =
    beat === 0
      ? c.calm(moveNum)
      : beat === 1
        ? `${moveNum}${side === 'white' ? '.' : '...'} ${playedSan}`
        : !showRefute
          ? c.crash(moment.loss)
          : c.bestWas(bestSan)

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      },
      () => {},
    )
  }

  return (
    <main className="flow moment">
      <p className="quiet mono moment-vs">{c.vs(opponent)}</p>
      <h1 className="display moment-title">{lost ? c.title : c.titleSlipped}</h1>

      <div className={`moment-stage${showCrash && !showRefute && !reduced ? ' moment-shake' : ''}`}>
        {showCrash && !showRefute && <div className="moment-flash" aria-hidden />}
        {showCrash && !showRefute && <span className="moment-stamp">{c.stamp}</span>}
        <div className="board-row">
          <EvalBar ev={ev} flip={flip} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Board
              fen={fen}
              size={520}
              flip={flip}
              coords
              lastMove={lastMove}
              tint={beat >= 1 && !showRefute ? 'var(--blunder)' : undefined}
              badge={badge}
              arrows={arrows}
              alt={`the moment: move ${moveNum}`}
            />
          </div>
        </div>
      </div>

      <p className="moment-caption mono" aria-live="polite">
        {caption}
      </p>

      <EvalCliff series={moment.cliff} width={320} height={64} />

      {showRoast && (
        <div className="moment-outro">
          <p className="moment-roast">{roast}</p>
          <div className="moment-actions">
            <button type="button" className="chip-button" onClick={play}>
              {c.replay}
            </button>
            <button type="button" className="chip-button" onClick={copyLink}>
              {copied ? c.copied : c.copyLink}
            </button>
            <Link className="chip-button" href={`/j/${jobId}/g/${gameId}`}>
              {c.backToGame}
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
