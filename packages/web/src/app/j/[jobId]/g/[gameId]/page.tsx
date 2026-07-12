'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BRAND_NAME,
  GAME_PHASES,
  enrichClassifications,
  fenBeforePly,
  finalStatus,
  gameAccuracies,
  moveMotif,
  phaseAccuracies,
  sanMoves,
  turningPoint,
  type Enriched,
  type Eval,
  type GamePhase,
  type Motif,
} from '@forked/shared'
import { Board } from '../../../../../components/Board'
import { AccuracyRing, KEY_TIERS, TIER, TierIcon } from '../../../../../components/classification'
import { EvalBar, formatEval } from '../../../../../components/EvalBar'
import { CoachCard, EvalGraph, MoveList } from '../../../../../components/EvalGraph'
import { copy, formatDate } from '../../../../../copy'
import { getGameReport, getJob, type GameReport } from '../../../../../lib/api'
import { LiveEngine, type EngineUpdate } from '../../../../../lib/engine'
import { clickMove, destsFor } from '../../../../../lib/moves'

// Rows always shown in the summary table even at zero, matching chess.com's
// convention of always naming the headline tiers.
const SUMMARY_ROWS: Enriched[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
]
const SUMMARY_ALWAYS = new Set<Enriched>(['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder'])

// End-of-review outcome line: mate names the winner, stalemate/draw are
// fixed, otherwise it falls back to the stored result string.
function outcomeLine(
  terminal: 'checkmate' | 'stalemate' | null,
  result: string,
  white: string,
  black: string,
  lastMover: 'white' | 'black',
): string | null {
  if (terminal === 'checkmate') return copy.coach.outcomeCheckmate(lastMover === 'white' ? white : black)
  if (terminal === 'stalemate') return copy.coach.outcomeStalemate
  if (result === '1-0') return copy.coach.outcomeResult(white, result)
  if (result === '0-1') return copy.coach.outcomeResult(black, result)
  if (result === '1/2-1/2') return copy.coach.outcomeDraw
  return null
}

// Turns a structured moveMotif result (shared/classify.ts) into the actual
// sentence via a copy.ts template — moveMotif itself only ever returns data.
function motifLine(m: Motif | null): string | null {
  if (!m) return null
  switch (m.kind) {
    case 'allowed-mate':
      return copy.coach.allowsMate(m.n)
    case 'missed-mate':
      return copy.coach.missedMate(m.n)
    case 'hung-piece':
      return copy.coach.hangs(m.piece)
    case 'best-capture':
      return copy.coach.bestWasTake(m.piece, m.square)
  }
}

const PHASE_LABEL: Record<GamePhase, string> = {
  opening: copy.coach.phaseOpening,
  middlegame: copy.coach.phaseMiddlegame,
  endgame: copy.coach.phaseEndgame,
}

// Plain +/-1 stepping, or (in the Key filter) the nearest key-tier ply in
// that direction — falling back to plain stepping when there is no further
// key ply. Shared by the toolbar buttons, the Next button, and the
// arrow-key handler so all three "next key moment" the same way.
function stepTo(current: number | null, dir: 1 | -1, total: number, filter: 'all' | 'key', keyPlies: number[]): number | null {
  const plain = dir === 1 ? Math.min(total, (current ?? 0) + 1) : current === null || current <= 1 ? null : current - 1
  if (filter !== 'key') return plain
  const cur = current ?? 0
  const next = dir === 1 ? keyPlies.find((p) => p > cur) : [...keyPlies].reverse().find((p) => p < cur)
  return next ?? plain
}

// The single-game wait (~10s): the status line plus an indeterminate sweep
// (reusing the .eval-bar loading track) and rotating status copy so the wait
// doesn't read as stalled. Honors prefers-reduced-motion via CSS only.
function AnalyzingBlock() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setStep((s) => (s + 1) % copy.browse.analyzingSteps.length), 2500)
    return () => clearInterval(iv)
  }, [])
  return (
    <>
      <p className="status-line">{copy.browse.analyzingGame}</p>
      <div className="eval-bar">
        <div className="analyzing-sweep" />
      </div>
      <p className="quiet">{copy.browse.analyzingSteps[step]}</p>
    </>
  )
}

// The pre-review summary: per-player accuracy plus a tier-count table split
// by mover. Shown in the coach card's slot while no move is selected yet.
function SummaryCard({
  white,
  black,
  whiteAcc,
  blackAcc,
  phaseAcc,
  enriched,
  turning,
  turningSan,
  onSelectTurning,
}: {
  white: string
  black: string
  whiteAcc: number | null
  blackAcc: number | null
  phaseAcc: Record<GamePhase, { white: number | null; black: number | null }>
  enriched: Enriched[]
  turning: number | null
  turningSan: string | null
  onSelectTurning: (ply: number) => void
}) {
  const counts = { white: {} as Record<Enriched, number>, black: {} as Record<Enriched, number> }
  for (const t of SUMMARY_ROWS) {
    counts.white[t] = 0
    counts.black[t] = 0
  }
  enriched.forEach((t, i) => {
    if (!SUMMARY_ROWS.includes(t)) return
    counts[i % 2 === 0 ? 'white' : 'black'][t] += 1
  })
  const rows = SUMMARY_ROWS.filter((t) => SUMMARY_ALWAYS.has(t) || counts.white[t] > 0 || counts.black[t] > 0)

  return (
    <div className="coach-card summary-card">
      {turning !== null && turningSan && (
        <button
          className="chip-button"
          style={{ width: '100%', textAlign: 'left', marginBottom: 8 }}
          onClick={() => onSelectTurning(turning)}
        >
          {copy.coach.turnedOn(String(Math.ceil(turning / 2)), turningSan)}
        </button>
      )}
      <div className="summary-heads mono">
        <span>{white}</span>
        <span>{black}</span>
      </div>
      <div className="summary-heads mono" style={{ alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {whiteAcc !== null && <AccuracyRing pct={whiteAcc} />}
          {whiteAcc !== null ? copy.coach.accuracy : '—'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {blackAcc !== null && <AccuracyRing pct={blackAcc} />}
          {blackAcc !== null ? copy.coach.accuracy : '—'}
        </span>
      </div>
      <table className="summary-table mono quiet">
        <tbody>
          {GAME_PHASES.map((ph) => (
            <tr key={ph}>
              <td>{phaseAcc[ph].white !== null ? `${phaseAcc[ph].white.toFixed(1)}%` : '—'}</td>
              <td className="summary-label">{PHASE_LABEL[ph]}</td>
              <td>{phaseAcc[ph].black !== null ? `${phaseAcc[ph].black.toFixed(1)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="summary-table mono">
        <tbody>
          {rows.map((t) => (
            <tr key={t}>
              <td>{counts.white[t]}</td>
              <td className="summary-label">
                <TierIcon kind={t} size={16} /> {TIER[t].word}
              </td>
              <td>{counts.black[t]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Retry mode's coach-card slot (A2): swaps in for CoachCard while retrying
// a mistake/miss/blunder ply. Three states — still guessing, wrong-but-legal
// (offers the reveal chip), and solved.
function RetryCard({ outcome, onShowBest }: { outcome: 'wrong' | 'success' | null; onShowBest: () => void }) {
  if (outcome === 'success') {
    return (
      <div className="coach-card">
        <div className="coach-head">
          <TierIcon kind="best" size={22} />
          <strong>{copy.coach.retrySuccess}</strong>
        </div>
      </div>
    )
  }
  if (outcome === 'wrong') {
    return (
      <div className="coach-card">
        <strong>{copy.coach.retryWrong}</strong>
        <button className="chip-button" style={{ marginTop: 8 }} onClick={onShowBest}>
          {copy.coach.showBest}
        </button>
      </div>
    )
  }
  return <p className="coach-card quiet">{copy.coach.retryPrompt}</p>
}

// Live explore mode's coach-card slot (Wave 2): swaps in while a branch is
// active. Same fixed-height .coach-card slot as CoachCard/RetryCard (the
// class, not a variant), so the toolbar below never shifts on entry.
function ExploreCard({
  sans,
  engineStatus,
  liveUpdate,
  bestSans,
}: {
  sans: string[]
  engineStatus: 'off' | 'loading' | 'ready' | 'failed'
  liveUpdate: EngineUpdate | null
  bestSans: string[]
}) {
  return (
    <div className="coach-card">
      <div className="coach-head">
        <TierIcon kind="best" size={22} />
        <strong>{sans.length ? copy.coach.exploreMoves(sans.join(' ')) : copy.coach.exploreYourMove}</strong>
      </div>
      {engineStatus === 'loading' && <div className="quiet coach-pv">{copy.coach.exploreLoadingEngine}</div>}
      {engineStatus === 'failed' && <div className="quiet coach-pv">{copy.coach.exploreUnavailable}</div>}
      {engineStatus === 'ready' && liveUpdate && liveUpdate.lines[0] && (
        <div className="quiet coach-pv mono">
          {copy.coach.exploreEvalLine(formatEval(liveUpdate.lines[0].eval), liveUpdate.depth, bestSans.join(' '))}
        </div>
      )}
    </div>
  )
}

// The per-game review, chess.com style: eval bar flush against a big board
// with coordinates, last-move tint, and a classification badge; a right panel
// with a coach card / summary, a Best-preview + Next button row, the move
// list, the eval graph, and a fixed prev/next/first/last toolbar. Nothing
// above the toolbar changes height, so it and the buttons never move as the
// coach text length varies. Polls until the engine record lands, so a
// just-requested single-game analysis resolves in place instead of showing
// "no analysis".
export default function Report({ params }: { params: Promise<{ jobId: string; gameId: string }> }) {
  const { jobId, gameId } = use(params)
  const [report, setReport] = useState<GameReport | null>(null)
  const [missing, setMissing] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [preview, setPreview] = useState(false)
  // Retry mode (A2): separate from preview so a reveal-after-wrong-guess can
  // reuse the preview rendering path without the two states fighting over
  // the same flag. `from` is the clicked origin square (null = nothing
  // picked yet); `outcome` is null while still guessing.
  const [retry, setRetry] = useState<{ from: string | null; outcome: 'wrong' | 'success' | null } | null>(null)
  // Live explore mode (Wave 2): a free-play branch off the mainline. `base`
  // plies of the mainline stay fixed once the branch starts; `moves` grows
  // (Undo) or shrinks (Undo) from there. `exploreSel` is the in-progress
  // piece-then-destination click state (clickMove), separate from retry's
  // own `from` so the two modes never fight over one field.
  const [explore, setExplore] = useState<{ base: number; moves: string[] } | null>(null)
  const [exploreSel, setExploreSel] = useState<string | null>(null)
  const [engineStatus, setEngineStatus] = useState<'off' | 'loading' | 'ready' | 'failed'>('off')
  const [liveUpdate, setLiveUpdate] = useState<EngineUpdate | null>(null)
  const engineRef = useRef<LiveEngine | null>(null)
  // The one-time start() handshake, shared by every effect run: a second
  // explore move during the ~1s engine load must await the SAME promise, not
  // skip startup because engineRef is already set — and a rejected start
  // keeps rejecting, so 'failed' stays failed instead of flipping to 'ready'.
  const engineStartRef = useRef<Promise<void> | null>(null)
  const [backHref, setBackHref] = useState(`/j/${jobId}/breakdown`)
  const [filter, setFilter] = useState<'all' | 'key'>('all')
  const plyInitedRef = useRef(false)
  const notFoundStreakRef = useRef(0)

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
    if (report?.game) document.title = `${report.game.white.name} vs ${report.game.black.name} | ${BRAND_NAME}`
  }, [report])

  // C3: 1.5s while fresh, backing off to 5s once this game has been polling
  // for over a minute — recursive setTimeout (not setInterval) so the delay
  // can change mid-flight.
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    notFoundStreakRef.current = 0
    const startedAt = Date.now()
    function schedule() {
      timer = setTimeout(tick, Date.now() - startedAt > 60_000 ? 5000 : 1500)
    }
    async function tick() {
      const r = await getGameReport(jobId, gameId)
      if (stop) return
      if (r === 'notFound') {
        notFoundStreakRef.current += 1
        // Tolerate a creation race (the record can land a beat after the job
        // reports this game) but stop polling a game/job pair that will
        // never exist (~8 ticks, ~12s).
        if (notFoundStreakRef.current >= 8) {
          setMissing(true)
          return
        }
        schedule()
        return
      }
      notFoundStreakRef.current = 0
      if (r?.record) {
        setReport(r)
      } else if (r && r.status === 'failed') {
        setMissing(true)
      } else {
        schedule()
      }
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [jobId, gameId])

  const record = report?.record ?? null
  const total = record?.plies.length ?? 0

  const sans = useMemo(() => (record ? sanMoves(record.uciMoves) : []), [record])
  const enriched = useMemo(() => (record ? enrichClassifications(record) : []), [record])
  // Plies whose enriched tier is "key" (same set as the eval-graph dots and
  // move-list filter), in order — the jump targets for A5 key-moment stepping.
  const keyPlies = useMemo(
    () => enriched.flatMap((t, i) => (KEY_TIERS.has(t) ? [i + 1] : [])),
    [enriched],
  )

  // Arrow-key move stepping; ArrowLeft from move 1 steps back to the start
  // position (selected null), ArrowRight from the start goes to move 1. In
  // the Key filter this jumps to the nearest key ply instead (see stepTo).
  // A 0-ply record (no analyzed moves) is a no-op.
  useEffect(() => {
    if (total === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      // Explore mode repurposes the arrow keys: Left undoes a branch move,
      // Right is a no-op (there is no "redo" — chess.com's model is a single
      // line, not a tree).
      if (explore) {
        if (e.key === 'ArrowLeft') undoExplore()
        return
      }
      setSelected((s) => stepTo(s, e.key === 'ArrowRight' ? 1 : -1, total, filter, keyPlies))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total, filter, keyPlies, explore])

  // Best-move preview is a one-off look; any new selection cancels it.
  useEffect(() => setPreview(false), [selected])
  // Retry mode is the same: stepping or picking another ply exits it.
  useEffect(() => setRetry(null), [selected])
  // Explore mode: stepping or picking another ply exits it too (same pattern).
  useEffect(() => setExplore(null), [selected])
  // Any explore-move (or exit) clears the in-progress click selection.
  useEffect(() => setExploreSel(null), [explore])

  // The live position while exploring — base mainline plies plus the branch's
  // own moves — or null when not exploring. Independent of the `fen`/`ply`
  // derivation below (which needs the post-guard `record`) so the engine
  // effect can run unconditionally, before the loading/missing early returns.
  const exploreFen = useMemo(() => {
    if (!explore || !record) return null
    return fenBeforePly(
      [...record.uciMoves.slice(0, explore.base), ...explore.moves],
      explore.base + explore.moves.length + 1,
    )
  }, [explore, record])

  // Lazy engine: created + started on the first explore position, then
  // re-analyzed on every subsequent one. A worker/start failure marks the
  // engine 'failed' — exploring still works, just without evals.
  useEffect(() => {
    if (!exploreFen) {
      engineRef.current?.stop()
      setLiveUpdate(null)
      return
    }
    setLiveUpdate(null)
    const fen = exploreFen
    let cancelled = false
    async function run() {
      if (!engineRef.current) {
        engineRef.current = new LiveEngine()
        setEngineStatus('loading')
        engineStartRef.current = engineRef.current.start()
      }
      try {
        await engineStartRef.current
      } catch {
        if (!cancelled) setEngineStatus('failed')
        return
      }
      if (cancelled) return
      setEngineStatus('ready')
      engineRef.current.analyze(fen, (u) => {
        if (!cancelled) setLiveUpdate(u)
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [exploreFen])

  // Dispose the worker on unmount only — not on every explore change.
  useEffect(() => {
    return () => engineRef.current?.dispose()
  }, [])

  const terminal = useMemo(() => (record ? finalStatus(record.uciMoves) : null), [record])
  const accuracies = useMemo(
    () => (record ? gameAccuracies(record, terminal) : { white: null, black: null }),
    [record, terminal],
  )
  const phaseAcc = useMemo(
    () =>
      record
        ? phaseAccuracies(record, terminal)
        : (Object.fromEntries(GAME_PHASES.map((ph) => [ph, { white: null, black: null }])) as Record<
            GamePhase,
            { white: number | null; black: number | null }
          >),
    [record, terminal],
  )
  const turning = useMemo(() => (record ? turningPoint(record) : null), [record])
  const motifs = useMemo(() => (record ? moveMotif(record, enriched) : []), [record, enriched])

  // ?ply= deep link: read once, the first time the record lands, and select
  // that ply if it's in range. A plain history.replaceState (not the
  // next/navigation router) keeps every step-through from growing the
  // back-button stack.
  useEffect(() => {
    if (!record || plyInitedRef.current) return
    plyInitedRef.current = true
    const n = Number(new URLSearchParams(window.location.search).get('ply'))
    if (Number.isInteger(n) && n >= 1 && n <= total) setSelected(n)
  }, [record, total])

  // Debounced ~250ms: rapid arrow-key stepping (QA5) can call replaceState
  // faster than Chrome's history-throttle allows, freezing the URL — the
  // selected ply itself still updates instantly, only the URL sync lags.
  useEffect(() => {
    if (!record) return
    const t = setTimeout(() => {
      const url = new URL(window.location.href)
      if (selected === null) url.searchParams.delete('ply')
      else url.searchParams.set('ply', String(selected))
      window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    }, 250)
    return () => clearTimeout(t)
  }, [record, selected])

  // SAN for the selected ply's best move and engine line, replayed from the
  // position before that ply.
  const coach = useMemo(() => {
    if (!record || selected === null) return null
    const p = record.plies.find((q) => q.ply === selected)
    if (!p) return null
    const prefix = record.uciMoves.slice(0, p.ply - 1)
    return {
      p,
      san: sans[p.ply - 1] ?? p.played,
      bestSan: p.best === p.played ? null : (sanMoves([p.best], prefix)[0] ?? p.best),
      pv: sanMoves(p.pv, prefix),
    }
  }, [record, selected, sans])

  if (missing) return <main className="flow"><p className="quiet">{copy.browse.noAnalysis}</p></main>
  if (!report?.record || !record) {
    return (
      <main className="flow" aria-busy="true">
        <AnalyzingBlock />
      </main>
    )
  }
  const { game } = report
  const flip = report.userColor === 'black'
  const ply = coach?.p ?? null
  const tier: Enriched = selected !== null ? enriched[selected - 1] ?? 'none' : 'none'

  // Retry mode reuses the preview rendering path once it's solved — from
  // then on the board and badge look exactly like the existing Best preview.
  const showBestLine = preview || retry?.outcome === 'success'
  const retryGuessing = retry !== null && retry.outcome !== 'success'

  // Explore goes first: it overrides every other mode's board state (entering
  // it already cancels preview/retry — see the [selected] effects above).
  // exploreFen is non-null whenever explore is (same record, same render).
  let fen: string
  if (explore && exploreFen) {
    fen = exploreFen
  } else if (retryGuessing) {
    fen = fenBeforePly(record.uciMoves, selected ?? 0)
  } else if (showBestLine && ply && selected !== null) {
    fen = fenBeforePly([...record.uciMoves.slice(0, selected - 1), ply.best], selected + 1)
  } else {
    fen = fenBeforePly(record.uciMoves, (selected ?? 0) + 1)
  }

  // Eval at ply n (walking back to the nearest non-null evalAfter, else the
  // game's start eval) — the explore branch's fallback before the live
  // engine has produced anything for the base position.
  const evalAfterPly = (n: number): Eval => {
    for (let i = n - 1; i >= 0; i--) {
      const e = record.plies[i]?.evalAfter
      if (e) return e
    }
    return record.startEval
  }

  // The eval shown on the bar: while exploring, the live engine's read (once
  // it has one) else the eval at the branch point. Otherwise the latest
  // non-null eval at or before the selected ply (terminal mate/stalemate
  // plies store null), else the start. While previewing the best move (or
  // retrying one), show the eval BEFORE the selected ply — the board isn't
  // showing the played move's damage.
  let shownEval: Eval
  if (explore) {
    shownEval = liveUpdate?.lines[0]?.eval ?? evalAfterPly(explore.base)
  } else {
    shownEval = record.startEval
    if (selected !== null) {
      for (let i = selected - (showBestLine || retry ? 2 : 1); i >= 0; i--) {
        const e = record.plies[i]?.evalAfter
        if (e) {
          shownEval = e
          break
        }
      }
    }
  }

  let badge: { square: string; kind: Enriched } | undefined
  let lastMove: { from: string; to: string } | undefined
  let tint: string | undefined
  let arrows: { from: string; to: string; color: string }[] | undefined

  if (explore) {
    // No badge (branched moves have no stored classification — ponytail:
    // live classification deferred) and no stored tint override: leaving
    // `tint` undefined falls back to Board's default yellow last-move glow,
    // a deliberately neutral hint distinct from every tier color.
    const last = explore.moves[explore.moves.length - 1]
    if (last) lastMove = { from: last.slice(0, 2), to: last.slice(2, 4) }
    if (liveUpdate?.lines[0]?.pvUci[0]) {
      const pv0 = liveUpdate.lines[0].pvUci[0]
      arrows = [{ from: pv0.slice(0, 2), to: pv0.slice(2, 4), color: 'var(--best)' }]
    }
  } else if (retryGuessing) {
    // No badge/tint/arrows while guessing — those would give the answer away.
  } else if (showBestLine && ply) {
    const dest = ply.best.slice(2, 4)
    badge = { square: dest, kind: 'best' }
    lastMove = { from: ply.best.slice(0, 2), to: dest }
    tint = `${TIER.best.color}66`
  } else if (ply) {
    const dest = ply.played.slice(2, 4)
    badge = tier !== 'none' ? { square: dest, kind: tier } : undefined
    lastMove = { from: ply.played.slice(0, 2), to: dest }
    tint = tier !== 'none' ? `${TIER[tier].color}66` : undefined
    // Stockfish's recommendation on every ply where something better existed
    // (not just the bad tiers) — book moves excepted, and no arrow when the
    // played move already was the best one.
    if (ply.best !== ply.played && !ply.book) {
      arrows = [{ from: ply.best.slice(0, 2), to: ply.best.slice(2, 4), color: 'var(--best)' }]
    }
  }

  const top = flip ? game.white : game.black
  const bottom = flip ? game.black : game.white

  const step = (dir: 1 | -1) => setSelected((s) => stepTo(s, dir, total, filter, keyPlies))

  // Click-driven selection (move list, eval graph, summary chip): exits any
  // active mode explicitly. Re-clicking the already-selected ply is a
  // same-value setSelected React bails out of, so the [selected] mode-exit
  // effects above never fire for that path.
  const select = (p: number | null) => {
    setPreview(false)
    setRetry(null)
    setExplore(null)
    setSelected(p)
  }

  const showBest = ply !== null && ply.best !== ply.played && !ply.book
  const canRetry = ply !== null && (tier === 'mistake' || tier === 'miss' || tier === 'blunder')

  // Retry click handler (A2), now a thin wrapper over the shared clickMove
  // state machine. Grading is an exact uci match against p.best — no engine
  // eval of arbitrary legal moves (ponytail: exact-match only, good enough
  // for a lite practice loop).
  function onRetrySquareClick(sq: string) {
    if (!retry || retry.outcome === 'success' || !ply) return
    const r = clickMove(fen, retry.from, sq)
    if (r.kind === 'select') setRetry({ from: r.from, outcome: null })
    else if (r.kind === 'deselect' || r.kind === 'reset') setRetry({ from: null, outcome: null })
    else setRetry({ from: null, outcome: r.uci === ply.best ? 'success' : 'wrong' })
  }

  // Explore click handler (Wave 2, item 5): the plain (no preview/no retry)
  // board is always clickable. A completed legal move enters explore (base =
  // the mainline plies kept, captured once) or extends the current branch.
  const clickable = !retryGuessing && !showBestLine
  function onExploreSquareClick(sq: string) {
    const r = clickMove(fen, exploreSel, sq)
    if (r.kind === 'select') setExploreSel(r.from)
    else if (r.kind === 'deselect' || r.kind === 'reset') setExploreSel(null)
    else {
      setExploreSel(null)
      // Clear the previous position's engine data in the same batch — the
      // [exploreFen] effect also clears it, but only after one frame has
      // painted the old eval/arrow on the new position.
      setLiveUpdate(null)
      setExplore((ex) => (ex ? { base: ex.base, moves: [...ex.moves, r.uci] } : { base: selected ?? 0, moves: [r.uci] }))
    }
  }

  // Undo pops one branch move; emptying the branch exits explore entirely
  // (shared by the ArrowLeft handler above and the Undo chip below).
  function undoExplore() {
    setLiveUpdate(null)
    setExplore((ex) => (ex && ex.moves.length > 1 ? { base: ex.base, moves: ex.moves.slice(0, -1) } : null))
  }

  // End-of-review closure: once every ply has been stepped through, name the
  // outcome and offer the next action instead of just stopping (peak-end).
  const outcome =
    selected !== null && selected === total && total > 0
      ? outcomeLine(terminal, game.result, game.white.name, game.black.name, total % 2 === 1 ? 'white' : 'black')
      : null

  // Explore-mode SAN: the branch's own moves (for the ExploreCard headline
  // and the MoveList variation row) and the live engine's best-line preview
  // (pv sliced to 4 plies — enough to read, not a whole line).
  const explorePrefix = explore ? record.uciMoves.slice(0, explore.base) : []
  const exploreSans = explore ? sanMoves(explore.moves, explorePrefix) : []
  const exploreBestSans = explore && liveUpdate ? sanMoves(liveUpdate.lines[0]?.pvUci.slice(0, 4) ?? [], [...explorePrefix, ...explore.moves]) : []

  return (
    <main className="dash report">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="display" style={{ fontSize: '1.5rem', margin: 0 }}>
          {game.white.name} vs {game.black.name}
        </h1>
        <Link href={backHref}>{copy.browse.back}</Link>
      </header>
      <p className="quiet mono">
        {game.result} · {formatDate(game.date)} · {game.openingName ?? game.eco ?? 'unknown opening'}
      </p>

      <div className="review">
        <div className="review-left">
          <p className="player-row mono quiet">{top.name}{top.rating != null ? ` (${top.rating})` : ''}</p>
          <div className="board-row">
            <EvalBar ev={shownEval} flip={flip} />
            <div
              style={
                showBestLine || explore
                  ? { flex: 1, minWidth: 0, outline: '2px solid var(--best)', borderRadius: 2 }
                  : { flex: 1, minWidth: 0 }
              }
            >
              <Board
                fen={fen}
                size={560}
                flip={flip}
                coords
                lastMove={lastMove}
                tint={tint}
                badge={badge}
                arrows={arrows}
                alt={`position after ply ${selected ?? 0}`}
                onSquareClick={retryGuessing ? onRetrySquareClick : clickable ? onExploreSquareClick : undefined}
                selectedSq={retryGuessing ? (retry?.from ?? undefined) : clickable ? (exploreSel ?? undefined) : undefined}
                dests={retryGuessing ? destsFor(fen, retry?.from ?? null) : clickable ? destsFor(fen, exploreSel) : undefined}
              />
            </div>
          </div>
          <p className="player-row mono quiet">{bottom.name}{bottom.rating != null ? ` (${bottom.rating})` : ''}</p>
        </div>

        <div className="review-panel">
          {explore ? (
            <ExploreCard sans={exploreSans} engineStatus={engineStatus} liveUpdate={liveUpdate} bestSans={exploreBestSans} />
          ) : selected === null ? (
            <SummaryCard
              white={game.white.name}
              black={game.black.name}
              whiteAcc={accuracies.white}
              blackAcc={accuracies.black}
              phaseAcc={phaseAcc}
              enriched={enriched}
              turning={turning}
              turningSan={turning !== null ? (sans[turning - 1] ?? null) : null}
              onSelectTurning={select}
            />
          ) : retry ? (
            <RetryCard outcome={retry.outcome} onShowBest={() => { setPreview(true); setRetry(null) }} />
          ) : (
            <CoachCard
              key={selected}
              p={ply}
              tier={tier}
              san={coach?.san ?? null}
              bestSan={coach?.bestSan ?? null}
              pv={coach?.pv ?? []}
              outcome={outcome}
              nextHref={backHref}
              preview={preview}
              motif={selected !== null ? motifLine(motifs[selected - 1] ?? null) : null}
              openingName={game.openingName}
            />
          )}

          <div className="button-row">
            {explore && (
              <button className="chip-button" onClick={undoExplore}>
                {copy.coach.exploreUndo}
              </button>
            )}
            {!retry && !explore && showBest && (
              <button className="chip-button" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
                {copy.coach.bestButton}
              </button>
            )}
            {!retry && !preview && !explore && canRetry && (
              <button className="chip-button" onClick={() => setRetry({ from: null, outcome: null })}>
                {copy.coach.tryAgain}
              </button>
            )}
            <button
              className="next-button"
              onClick={() => (explore ? setExplore(null) : retry ? setRetry(null) : preview ? setPreview(false) : step(1))}
              disabled={!preview && !retry && !explore && (total === 0 || selected === total)}
            >
              {preview || retry || explore ? copy.coach.resume : copy.coach.next}
            </button>
          </div>

          <div className="button-row">
            <button className="chip-button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              {copy.coach.filterAll}
            </button>
            <button className="chip-button" aria-pressed={filter === 'key'} onClick={() => setFilter('key')}>
              {copy.coach.filterKey}
            </button>
          </div>

          <div className="review-graph">
            <EvalGraph
              record={record}
              enriched={enriched}
              selected={selected}
              onSelect={select}
              turningPoint={turning}
              height={150}
            />
          </div>

          <MoveList
            record={record}
            sans={sans}
            enriched={enriched}
            selected={selected}
            previewPly={preview ? selected : null}
            bestSan={preview ? (coach?.bestSan ?? null) : null}
            onSelect={select}
            filter={filter}
            exploreLine={explore ? { afterPly: explore.base, sans: exploreSans } : null}
          />

          <div className="nav-toolbar">
            <button className="chip-button" onClick={() => setSelected(null)} disabled={selected === null} aria-label={copy.coach.firstLabel}>
              {copy.coach.navFirst}
            </button>
            <button className="chip-button" onClick={() => step(-1)} disabled={!!explore || selected === null} aria-label={copy.coach.prevLabel}>
              {copy.coach.navPrev}
            </button>
            <button className="chip-button" onClick={() => step(1)} disabled={!!explore || total === 0 || selected === total} aria-label={copy.coach.nextLabel}>
              {copy.coach.navNext}
            </button>
            <button className="chip-button" onClick={() => setSelected(total)} disabled={total === 0 || selected === total} aria-label={copy.coach.lastLabel}>
              {copy.coach.navLast}
            </button>
          </div>
          <p className="quiet keyboard-hint">{copy.coach.keysHint}</p>
        </div>
      </div>
    </main>
  )
}
