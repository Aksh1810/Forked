'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BRAND_NAME,
  GAME_PHASES,
  classifyLive,
  enrichClassifications,
  fenBeforePly,
  finalStatus,
  gameAccuracies,
  momentFor,
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
import { CheckmateFx } from '../../../../../components/CheckmateFx'
import { TIER, TierIcon } from '../../../../../components/classification'
import { EvalBar } from '../../../../../components/EvalBar'
import { CoachCard, EvalGraph, MoveList } from '../../../../../components/EvalGraph'
import { EngineLines } from '../../../../../components/EngineLines'
import { copy, formatDate, phaseLabels } from '../../../../../copy'
import { getGameReport, getJob, type GameReport } from '../../../../../lib/api'
import { poll } from '../../../../../lib/poll'
import { LiveEngine, type EngineUpdate } from '../../../../../lib/engine'
import { clickMove, destsFor, terminalEval } from '../../../../../lib/moves'
import {
  boardDecorations,
  branchFen as computeBranchFen,
  branchParentFen as computeBranchParentFen,
  estimatedElo,
  isMainlineStep,
  shownEval as computeShownEval,
  stepTo,
  type Branch,
  type LastLive,
} from '../../../../../lib/review-session'

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

// Always-visible top metrics strip: each player's accuracy, est. Elo, and the
// two counts that carry the story (brilliant, blunder). The viewer's side is
// ringed. Complements the pre-review SummaryCard (which still holds the full
// phase/tier tables in the panel).
function ReviewMetrics({
  white,
  black,
  whiteAcc,
  blackAcc,
  enriched,
  userColor,
}: {
  white: string
  black: string
  whiteAcc: number | null
  blackAcc: number | null
  enriched: Enriched[]
  userColor: 'white' | 'black' | null
}) {
  const count = (side: 0 | 1, tier: Enriched) => enriched.filter((t, i) => i % 2 === side && t === tier).length
  const cell = (name: string, acc: number | null, side: 0 | 1) => (
    <div className={`metric-cell${userColor === (side === 0 ? 'white' : 'black') ? ' metric-cell-you' : ''}`}>
      <div className="metric-name mono">{name}</div>
      <div className="metric-acc mono">{acc !== null ? `${acc.toFixed(1)}%` : '—'}</div>
      <div className="metric-elo">{acc !== null ? copy.coach.estEloLine(estimatedElo(acc)) : ''}</div>
      <div className="metric-chips mono">
        <span className="metric-chip"><TierIcon kind="brilliant" size={13} /> {count(side, 'brilliant')}</span>
        <span className="metric-chip"><TierIcon kind="blunder" size={13} /> {count(side, 'blunder')}</span>
      </div>
    </div>
  )
  return (
    <div className="review-metrics">
      {cell(white, whiteAcc, 0)}
      {cell(black, blackAcc, 1)}
    </div>
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
  verdict,
}: {
  white: string
  black: string
  whiteAcc: number | null
  blackAcc: number | null
  phaseAcc: Record<GamePhase, { white: number | null; black: number | null }>
  enriched: Enriched[]
  // E2: one-line verdict, reusing the same outcomeLine() the end-of-review
  // closure uses. Null for an unfinished/unresolved game.
  verdict: string | null
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
      {verdict && <p className="quiet" style={{ margin: '0 0 6px' }}>{verdict}</p>}
      <div className="summary-heads mono">
        <span>{white}</span>
        <span>{black}</span>
      </div>
      {/* E1: the headline is the accuracy % itself now; est. Elo demotes to
          the small qualified line underneath. */}
      <div className="summary-heads mono" style={{ alignItems: 'center' }}>
        <span className="summary-elo">
          {whiteAcc !== null ? `${whiteAcc.toFixed(1)}%` : '—'}
          <span className="summary-elo-label">{whiteAcc !== null ? copy.coach.estEloLine(estimatedElo(whiteAcc)) : ''}</span>
        </span>
        <span className="summary-elo" style={{ textAlign: 'right' }}>
          {blackAcc !== null ? `${blackAcc.toFixed(1)}%` : '—'}
          <span className="summary-elo-label">{blackAcc !== null ? copy.coach.estEloLine(estimatedElo(blackAcc)) : ''}</span>
        </span>
      </div>
      <table className="summary-table mono quiet">
        <tbody>
          {GAME_PHASES.map((ph) => (
            <tr key={ph}>
              <td>{phaseAcc[ph].white !== null ? `${phaseAcc[ph].white.toFixed(1)}%` : '—'}</td>
              <td className="summary-label">{phaseLabels[ph]}</td>
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

// Live branch mode's coach-card slot (Wave 2): swaps in while a branch is
// active. Same fixed-height .coach-card slot as CoachCard/SummaryCard (the
// class, not a variant), so the toolbar below never shifts on entry. Just the
// headline — engine status (loading/failed) is EngineLines' job alone now
// (FIX 7: this card used to duplicate that copy verbatim).
function BranchCard({ sans }: { sans: string[] }) {
  return (
    <div className="coach-card">
      <div className="coach-head">
        <TierIcon kind="best" size={22} />
        <strong>{sans.length ? copy.coach.exploreMoves(sans.join(' ')) : copy.coach.exploreYourMove}</strong>
      </div>
    </div>
  )
}

// The per-game review, chess.com style: eval bar flush against a big board
// with coordinates, last-move tint, and a classification badge; a right panel
// with a coach card / summary, the eval graph, the move list, and a fixed
// prev/next/first/last toolbar. Nothing above the toolbar changes height, so
// it never moves as the coach text length varies. Polls until the engine
// record lands, so a just-requested single-game analysis resolves in place
// instead of showing "no analysis".
export default function Report({ params }: { params: Promise<{ jobId: string; gameId: string }> }) {
  const { jobId, gameId } = use(params)
  const [report, setReport] = useState<GameReport | null>(null)
  const [missing, setMissing] = useState(false)
  // K6: distinct from `missing` — a run of network failures (not a
  // confirmed-absent record) gives up into an error line instead of an
  // infinite sweep.
  const [pollFailed, setPollFailed] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  // Live branch mode (Wave 2): a free-play branch off the mainline. `base`
  // plies of the mainline stay fixed once the branch starts; `moves` grows
  // from there. `boardSel` is the in-progress piece-then-destination click
  // state (clickMove).
  const [branch, setBranch] = useState<Branch | null>(null)
  const [boardSel, setBoardSel] = useState<string | null>(null)
  // Live badge for the last branch move (Task 6), judged once the live
  // engine reaches depth >= 12 on the resulting position.
  const [branchBadge, setBranchBadge] = useState<{ square: string; kind: Enriched } | null>(null)
  // The pending live judgment for the LAST user move: eval + best move of the
  // parent position, captured at play time. Judged once the child position's
  // live eval reaches depth >= 12.
  const pendingJudgeRef = useRef<{ before: Eval; bestUci: string | null; uci: string } | null>(null)
  // FIX 2: the last live eval the engine actually produced, keyed by the
  // exact fen it was produced for — NOT liveUpdate, which playUserMove
  // clears on every move. Used as the "before" baseline when a new branch
  // move is played; if it doesn't match the position being moved from (the
  // engine hasn't reached MIN_DEPTH there yet), that means there's no known
  // eval for that position and playUserMove must not guess one.
  const lastLiveRef = useRef<LastLive | null>(null)
  const [engineStatus, setEngineStatus] = useState<'off' | 'loading' | 'ready' | 'failed'>('off')
  const [liveUpdate, setLiveUpdate] = useState<EngineUpdate | null>(null)
  const engineRef = useRef<LiveEngine | null>(null)
  // The one-time start() handshake: the [shownFen] effect awaits this on
  // every run rather than re-checking engineRef, so a shownFen change during
  // the ~1s engine load queues behind the SAME promise instead of racing a
  // second start() — and a rejected start keeps rejecting, so 'failed' stays
  // failed instead of flipping to 'ready'.
  const engineStartRef = useRef<Promise<void> | null>(null)
  // Home until the job tells us whose games list to go back to. It must NOT
  // default to a per-job route: this renders before the getJob below resolves,
  // and stays put if that request fails.
  const [backHref, setBackHref] = useState('/')
  const plyInitedRef = useRef(false)
  const notFoundStreakRef = useRef(0)
  const netFailStreakRef = useRef(0)

  // Back to the games list this game was analyzed from.
  useEffect(() => {
    let stop = false
    getJob(jobId).then((j) => {
      if (!stop && j?.username) setBackHref(`/u/${j.username}`)
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
    notFoundStreakRef.current = 0
    netFailStreakRef.current = 0
    return poll(
      () => getGameReport(jobId, gameId),
      (r) => {
        if (r === 'notFound') {
          notFoundStreakRef.current += 1
          // Tolerate a creation race (the record can land a beat after the job
          // reports this game) but stop polling a game/job pair that will
          // never exist (~8 ticks, ~12s).
          if (notFoundStreakRef.current < 8) return 'again'
          setMissing(true)
          return 'done'
        }
        notFoundStreakRef.current = 0
        if (r === null) {
          // K6: a network failure (distinct from the API's own 'notFound')
          // used to just reschedule forever — count it toward the same kind
          // of give-up as notFound, with its own error line.
          netFailStreakRef.current += 1
          if (netFailStreakRef.current < 8) return 'again'
          setPollFailed(true)
          return 'done'
        }
        netFailStreakRef.current = 0
        if (r.record) {
          setReport(r)
          return 'done'
        }
        if (r.status === 'failed') {
          setMissing(true)
          return 'done'
        }
        return 'again'
      },
      (elapsed) => (elapsed > 60_000 ? 5000 : 1500),
    )
  }, [jobId, gameId])

  const record = report?.record ?? null
  const total = record?.plies.length ?? 0

  const sans = useMemo(() => (record ? sanMoves(record.uciMoves) : []), [record])
  const enriched = useMemo(() => (record ? enrichClassifications(record) : []), [record])

  // Arrow-key move stepping; ArrowLeft from move 1 steps back to the start
  // position (selected null), ArrowRight from the start goes to move 1.
  // A 0-ply record (no analyzed moves) is a no-op.
  // FIX 4 (spec §2): stepping always DISCARDS an active branch and steps the
  // mainline — a branch is exited wholesale, not undone move by move.
  useEffect(() => {
    if (total === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      setBranch(null)
      pendingJudgeRef.current = null
      setBranchBadge(null)
      setSelected((s) => stepTo(s, e.key === 'ArrowRight' ? 1 : -1, total))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total])

  // Branch mode: stepping or picking another ply exits it too (same pattern),
  // taking any pending/resolved live judgment on that branch with it.
  // Also clears liveUpdate here so the previous position's lines/depth don't
  // stay painted for a frame while the [shownFen] effect's own clear+re-run
  // catches up (Finding 2).
  useEffect(() => {
    setBranch(null)
    pendingJudgeRef.current = null
    setBranchBadge(null)
    setLiveUpdate(null)
  }, [selected])
  // Any branch move (or exit) clears the in-progress click selection.
  useEffect(() => setBoardSel(null), [branch])

  // The branch's own live fen — base mainline plies plus the branch's own
  // moves — or null when no branch is active. Independent of the `fen`/`ply`
  // derivation below (which needs the post-guard `record`) so it can be read
  // by the shownFen memo unconditionally, before the loading/missing early
  // returns.
  const branchFenValue = useMemo(() => {
    if (!branch || !record) return null
    return computeBranchFen(record, branch)
  }, [branch, record])

  // The position the board is showing (mainline or branch). The engine
  // analyzes it whenever engine output is visible — always.
  const shownFen = useMemo(() => {
    if (!record) return null
    if (branch && branchFenValue) return branchFenValue
    return fenBeforePly(record.uciMoves, (selected ?? 0) + 1)
  }, [record, branch, branchFenValue, selected])

  // Start the engine as soon as the record lands (always-on live analysis).
  useEffect(() => {
    if (!record || engineRef.current) return
    engineRef.current = new LiveEngine()
    setEngineStatus('loading')
    engineStartRef.current = engineRef.current.start()
    engineStartRef.current.then(
      () => setEngineStatus('ready'),
      () => setEngineStatus('failed'),
    )
  }, [record])

  // Re-analyze whenever the shown position changes. A worker/start failure
  // marks the engine 'failed' — the board still works, just without evals.
  useEffect(() => {
    if (!shownFen) {
      engineRef.current?.stop()
      setLiveUpdate(null)
      return
    }
    setLiveUpdate(null)
    const fen = shownFen
    let cancelled = false
    async function run() {
      try {
        await engineStartRef.current
      } catch {
        return
      }
      if (cancelled) return
      engineRef.current?.analyze(fen, (u) => {
        if (cancelled) return
        setLiveUpdate(u)
        // FIX 2: record the last-known-good eval for THIS exact position,
        // independent of liveUpdate (which gets cleared on every move).
        if (u.lines[0]) lastLiveRef.current = { fen, eval: u.lines[0].eval, bestUci: u.lines[0].pvUci[0] ?? null }
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [shownFen])

  // Dispose the worker on unmount only — not on every branch change.
  useEffect(() => {
    return () => engineRef.current?.dispose()
  }, [])

  // ponytail: judges only the latest move (no per-move history), depth 12
  // threshold hardcoded — chess.com-style refine delay, tune if it feels slow.
  // Keeps judging on every liveUpdate past depth 12 (not just the first) so
  // the badge refines as the search deepens instead of freezing on a shallow
  // read compared against the parent's deeper-settled "before" eval.
  useEffect(() => {
    const pending = pendingJudgeRef.current
    if (!pending || !branch) return
    const last = branch.moves[branch.moves.length - 1]
    if (last !== pending.uci) return // stale pending from a move that's since been undone/replaced
    // FIX 1c: a terminal update has no lines[0] to judge against — classifyLive
    // below would never run for the branch move that ends the game. Checkmate
    // badges the mating move 'best' directly; stalemate gets no badge.
    if (liveUpdate?.terminal) {
      const tEval = branchFenValue ? terminalEval(branchFenValue) : null
      setBranchBadge(tEval?.type === 'mate' ? { square: pending.uci.slice(2, 4), kind: 'best' } : null)
      return
    }
    // FIX 3: a non-terminal update with no lines[0] yet (still ramping up) —
    // nothing to judge against.
    if (!liveUpdate || !liveUpdate.lines[0] || liveUpdate.depth < 12) return
    const mover = (branch.base + branch.moves.length) % 2 === 1 ? 'white' : 'black'
    const kind = classifyLive(pending.before, liveUpdate.lines[0].eval, mover, pending.uci === pending.bestUci)
    setBranchBadge(kind !== 'none' ? { square: pending.uci.slice(2, 4), kind } : null)
  }, [liveUpdate, branch])

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

  if (pollFailed) return <main className="flow"><p className="quiet">{copy.outage.gamePoll}</p></main>
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
  const moment = report.userColor ? momentFor(record, report.userColor) : null
  const lostGame =
    (report.userColor === 'white' && game.result === '0-1') ||
    (report.userColor === 'black' && game.result === '1-0')
  // Checkmate flourish: on a checkmate the side that just moved delivered it,
  // so the last ply's mover is the winner. Fires only when the viewer is
  // actually looking at the final (mating) position.
  const mateWinner: 'white' | 'black' = total % 2 === 1 ? 'white' : 'black'
  const showMateFx =
    terminal === 'checkmate' && !branch && selected === total && report.userColor !== null
  const ply = coach?.p ?? null
  const tier: Enriched = selected !== null ? enriched[selected - 1] ?? 'none' : 'none'

  const fen: string = shownFen!

  // FIX 1b: the branch position one ply back — used below to find a
  // still-valid live eval while the new position's own search hasn't
  // produced one yet.
  const branchParentFenValue = branch ? computeBranchParentFen(record, branch) : null

  // The eval shown on the bar, and the board overlays (badge/last-move/tint/
  // arrows) for the shown position — see review-session.ts for the fallback
  // chain and per-mode decorations.
  const shownEval: Eval = computeShownEval({
    record,
    selected,
    branch,
    fen,
    liveUpdate,
    lastLive: lastLiveRef.current,
    branchParentFen: branchParentFenValue,
  })
  const { badge, lastMove, tint, arrows } = boardDecorations({ branch, branchBadge, liveUpdate, ply, tier })

  const top = flip ? game.white : game.black
  const bottom = flip ? game.black : game.white

  // FIX 4: stepping discards an active branch (spec §2) rather than being
  // disabled while one is active — shared by the nav-toolbar Prev/Next
  // buttons.
  const step = (dir: 1 | -1) => {
    setBranch(null)
    pendingJudgeRef.current = null
    setBranchBadge(null)
    setSelected((s) => stepTo(s, dir, total))
  }

  // Click-driven selection (move list, eval graph, summary chip): exits any
  // active mode explicitly. Re-clicking the already-selected ply is a
  // same-value setSelected React bails out of, so the [selected] mode-exit
  // effects above never fire for that path.
  const select = (p: number | null) => {
    setBranch(null)
    pendingJudgeRef.current = null
    setBranchBadge(null)
    setSelected(p)
  }

  // Plays a user move on the shown position: steps forward when it IS the
  // next mainline move (chess.com behavior), otherwise starts/extends the
  // single active branch. Shared by the board click handler and
  // EngineLines' onPlayMove (clicking a live line plays its first move).
  function playUserMove(uci: string) {
    if (!record) return
    setBoardSel(null)
    setLiveUpdate(null)
    // FIX 2: the only trustworthy "before" eval is one the engine actually
    // produced FOR the position being moved from (`fen`) — liveUpdate gets
    // cleared on every move, so a fast second branch move would otherwise
    // fall back to shownEval, which can belong to the mainline ply instead of
    // the branch. ponytail: fast successive moves go unbadged rather than
    // mis-badged — no guessing when the engine hasn't caught up to `fen` yet.
    const live = lastLiveRef.current?.fen === fen ? lastLiveRef.current : null
    if (isMainlineStep(record, selected, branch, uci)) {
      // Stepping the mainline forward — that ply already has a stored
      // classification (rendered outside branch mode), so any live judgment
      // in flight belongs to a branch move that no longer exists.
      pendingJudgeRef.current = null
      setBranchBadge(null)
      setSelected((selected ?? 0) + 1)
      return
    }
    pendingJudgeRef.current = live ? { before: live.eval, bestUci: live.bestUci, uci } : null
    setBranchBadge(null)
    setBranch((b) => (b ? { base: b.base, moves: [...b.moves, uci] } : { base: selected ?? 0, moves: [uci] }))
  }

  // Board click handler: the board is always clickable. A completed legal
  // move routes through playUserMove.
  function onBoardSquareClick(sq: string) {
    const r = clickMove(fen, boardSel, sq)
    if (r.kind === 'select') setBoardSel(r.from)
    else if (r.kind === 'deselect' || r.kind === 'reset') setBoardSel(null)
    else playUserMove(r.uci)
  }

  // The game's one-line verdict — used both as the end-of-review closure
  // (once every ply has been stepped through, peak-end) and, unconditionally
  // (E2), as the top-of-SummaryCard verdict before stepping starts.
  const verdict = total > 0 ? outcomeLine(terminal, game.result, game.white.name, game.black.name, total % 2 === 1 ? 'white' : 'black') : null
  const outcome = selected !== null && selected === total && total > 0 ? verdict : null

  // Branch-mode SAN: the branch's own moves, for the BranchCard headline,
  // the MoveList variation row, and the EngineLines panel's PV prefix.
  const branchPrefix = branch ? record.uciMoves.slice(0, branch.base) : []
  const branchSans = branch ? sanMoves(branch.moves, branchPrefix) : []

  return (
    <main className="dash report">
      {showMateFx && (
        <CheckmateFx key={selected} outcome={report.userColor === mateWinner ? 'win' : 'loss'} />
      )}
      {/* E4: .dash-head instead of a bespoke inline flex — same layout every
          other dashboard-style page header already uses. */}
      <header className="dash-head">
        <h1 className="display" style={{ fontSize: '1.5rem', margin: 0 }}>
          {game.white.name} vs {game.black.name}
        </h1>
        <Link href={backHref}>{copy.browse.back}</Link>
      </header>
      <p className="quiet mono">
        {game.result} · {formatDate(game.date)} · {game.openingName ?? game.eco ?? 'unknown opening'}
      </p>
      {moment && (
        <Link className="moment-cta" href={`/j/${jobId}/g/${gameId}/moment`}>
          {lostGame ? copy.coach.moment.openLost : copy.coach.moment.openSlipped}
        </Link>
      )}

      {/* Always-visible metrics strip — accuracy + brilliant/blunder counts per
          player, hoisted to the top per chess.com's Game Review hierarchy. The
          viewer's side is emphasized. */}
      <ReviewMetrics
        white={game.white.name}
        black={game.black.name}
        whiteAcc={accuracies.white}
        blackAcc={accuracies.black}
        enriched={enriched}
        userColor={report.userColor}
      />

      <div className="review">
        <div className="review-left">
          <p className="player-row mono quiet">{top.name}{top.rating != null ? ` (${top.rating})` : ''}</p>
          <div className="board-row">
            <EvalBar ev={shownEval} flip={flip} />
            <div
              style={
                branch
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
                onSquareClick={onBoardSquareClick}
                selectedSq={boardSel ?? undefined}
                dests={destsFor(fen, boardSel)}
              />
            </div>
          </div>
          <p className="player-row mono quiet">{bottom.name}{bottom.rating != null ? ` (${bottom.rating})` : ''}</p>

          {/* Live engine lines live under the board: depth + top-3 PVs. */}
          <EngineLines
            status={engineStatus}
            update={liveUpdate}
            prefixUci={branch ? [...branchPrefix, ...branch.moves] : record.uciMoves.slice(0, selected ?? 0)}
            onPlayMove={playUserMove}
          />
        </div>

        <div className="review-panel">
          {branch ? (
            <BranchCard sans={branchSans} />
          ) : selected === null ? (
            <SummaryCard
              white={game.white.name}
              black={game.black.name}
              whiteAcc={accuracies.white}
              blackAcc={accuracies.black}
              phaseAcc={phaseAcc}
              enriched={enriched}
              verdict={verdict}
            />
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
              motif={selected !== null ? motifLine(motifs[selected - 1] ?? null) : null}
              openingName={game.openingName}
            />
          )}

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

          {/* Moves + step buttons travel together: on mobile this wrapper
              becomes a dock fixed to the bottom of the viewport, so the board
              and the moves bar own the first screen and everything else is
              scrolled to. On desktop it's `display: contents` — a pass-through
              that leaves both children as direct .review-panel flex items. */}
          <div className="review-dock">
            <MoveList
              record={record}
              sans={sans}
              enriched={enriched}
              selected={selected}
              onSelect={select}
              exploreLine={branch ? { afterPly: branch.base, sans: branchSans } : null}
            />

            <div className="nav-toolbar">
              <button className="chip-button" onClick={() => select(null)} disabled={!branch && selected === null} aria-label={copy.coach.firstLabel}>
                {copy.coach.navFirst}
              </button>
              <button className="chip-button" onClick={() => step(-1)} disabled={selected === null} aria-label={copy.coach.prevLabel}>
                {copy.coach.navPrev}
              </button>
              <button className="chip-button" onClick={() => step(1)} disabled={total === 0 || selected === total} aria-label={copy.coach.nextLabel}>
                {copy.coach.navNext}
              </button>
              <button className="chip-button" onClick={() => select(total)} disabled={total === 0 || (!branch && selected === total)} aria-label={copy.coach.lastLabel}>
                {copy.coach.navLast}
              </button>
            </div>
          </div>
          <p className="quiet keyboard-hint">
            <kbd>←</kbd> <kbd>→</kbd> {copy.coach.keysHint}
          </p>
        </div>
      </div>
    </main>
  )
}
