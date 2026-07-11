'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { copy, pickTeaser } from '../../../copy'
import { Story } from '../../../components/Story'
import { getJob, type JobView } from '../../../lib/api'

// The progress experience: the multi-minute wait is the anticipation phase.
// On completion this page becomes the story (Phase 4); until then it settles
// into a quiet completion state at the same URL.
export default function Progress({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params)
  const router = useRouter()
  const [job, setJob] = useState<JobView | null>(null)
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)

  const terminal = job?.status === 'complete' || job?.status === 'failed'

  // A single-game job has no story; send it straight to that game's report,
  // whatever its status (the report page shows the analyzing state itself).
  useEffect(() => {
    if (job?.kind === 'single' && job.gameId) {
      router.replace(`/j/${jobId}/g/${job.gameId}`)
    }
  }, [job, jobId, router])

  // C3: 2s while fresh, backing off to 5s once this job has been polling for
  // over a minute — recursive setTimeout (not setInterval) so the delay can
  // change mid-flight.
  useEffect(() => {
    if (terminal) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const startedAt = Date.now()
    async function poll() {
      const j = await getJob(jobId).catch(() => null)
      if (stop) return
      if (j) setJob(j)
      else setMissing(true)
      if (stop) return
      timer = setTimeout(poll, Date.now() - startedAt > 60_000 ? 5000 : 2000)
    }
    void poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [jobId, terminal])

  // One rotating status line on a 4-second cadence. The teaser slot replaces
  // it with real forming data once Phase 4 activates pickTeaser.
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 4000)
    return () => clearInterval(iv)
  }, [])

  // Fetch the per-game failure list exactly once, when the job settles.
  useEffect(() => {
    if (!terminal || !job || job.failed === 0 || job.failures) return
    void getJob(jobId, true).then((j) => j && setJob(j))
  }, [terminal, job, jobId])

  const pps = useMemo(() => positionsPerSecond(job), [job])

  if (missing) {
    return (
      <main className="flow progress-main">
        <p className="status-line">{copy.progress.notFound}</p>
      </main>
    )
  }
  if (!job) return <main className="flow progress-main" aria-busy="true" />

  // The page auto-transitions into the story on completion, at the same URL.
  if (job.status === 'complete' && job.wrapped) {
    return <Story wrapped={job.wrapped} jobId={jobId} />
  }

  const settled = job.completed + job.failed
  const fraction = job.total > 0 ? settled / job.total : 0
  const statusLine = pickTeaser(job.agg, job.completed, job.total) ?? copy.statusLines[tick % copy.statusLines.length]
  const chips = [...job.ring].reverse()

  return (
    <main className="flow progress-main">
      <div
        className="eval-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={settled}
        aria-label={copy.progress.gamesLabel}
      >
        <div className="eval-bar-fill" style={{ width: `${fraction * 100}%` }} />
      </div>

      <div>
        <div className="mono big-counter">
          {job.completed} / {job.total}
        </div>
        <div className="counter-label">{copy.progress.gamesLabel}</div>
      </div>

      {pps !== null && !terminal && (
        <div>
          <div className="mono big-counter">{pps.toFixed(1)}</div>
          <div className="counter-label">{copy.progress.ppsLabel}</div>
        </div>
      )}

      {job.status === 'analyzing' && job.etaSeconds !== null && job.etaSeconds > 0 && (
        <p className="quiet">{etaLine(job.etaSeconds)}</p>
      )}

      {!terminal && <p className="status-line">{statusLine}</p>}

      {terminal && (
        <div>
          <p className="status-line display" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {job.status === 'complete' ? copy.progress.completeTitle : copy.progress.failedTitle}
          </p>
          <p className="quiet">
            {job.status === 'complete' ? copy.progress.completeNote : copy.progress.failedNote}
          </p>
          {job.failures && job.failures.length > 0 && (
            <div>
              <p className="quiet">{copy.progress.skippedGames(job.failures.length)}</p>
              <ul className="failures">
                {job.failures.map((f) => (
                  <li key={f.gameId}>{f.error ?? 'Could not be analyzed.'}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {chips.length > 0 && (
        <ul className="chips" aria-label="completed games">
          {chips.map((g) => (
            <li className="chip mono" key={g.gameId}>
              <span className={`res-${g.res === '?' ? 'q' : g.res}`}>{g.res.toUpperCase()}</span>{' '}
              {g.opp}
              {g.accuracy !== null && <span className="quiet"> {g.accuracy.toFixed(1)}%</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="quiet">{copy.yourLink}</p>
    </main>
  )
}

// "about N min left" / "under a minute left" (item 3): rounds up so a job
// with 1s remaining still reads as "about 1 min" rather than "0 min".
function etaLine(sec: number): string {
  return sec < 60 ? copy.progress.etaUnderMinute : copy.progress.etaMinutes(Math.ceil(sec / 60))
}

// Real throughput from the ring buffer: plies of every entry except the
// oldest, over the time span the ring covers.
function positionsPerSecond(job: JobView | null): number | null {
  if (!job || job.ring.length < 2) return null
  const times = job.ring.map((r) => new Date(r.finishedAt).getTime())
  const span = (Math.max(...times) - Math.min(...times)) / 1000
  if (span <= 0) return null
  const oldest = times.indexOf(Math.min(...times))
  const plies = job.ring.reduce((sum, r, i) => (i === oldest ? sum : sum + r.plies), 0)
  return plies / span
}
