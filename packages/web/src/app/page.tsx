'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { copy } from '../copy'
import { getPositionsJudged, postIngest } from '../lib/api'

export default function Landing() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [pgn, setPgn] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    const res = await postIngest({
      username: username.trim() || undefined,
      pgn: pgn.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    })
    setBusy(false)
    if (res.ok) {
      router.push(`/j/${res.jobId}`)
      return
    }
    if (res.code === 'archive-too-large') setExpanded(true)
    setError(copy.errors[res.code] ?? copy.errors.generic)
  }

  return (
    <main className="flow">
      <h1 className="display headline">
        Do you know why you lose<span className="qq">??</span>
      </h1>
      <p className="sub">{copy.sub}</p>

      <form onSubmit={submit}>
        <input
          className="field"
          placeholder={copy.inputPlaceholder}
          aria-label={copy.inputPlaceholder}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="cta" type="submit" disabled={busy}>
          {busy ? copy.ctaBusy : copy.cta}
        </button>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="link-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {copy.expandToggle}
        </button>
        {expanded && (
          <div className="expand-row">
            <textarea
              className="field"
              rows={5}
              placeholder={copy.pgnPlaceholder}
              aria-label={copy.pgnPlaceholder}
              value={pgn}
              onChange={(e) => setPgn(e.target.value)}
            />
            <div className="range-row">
              <label>
                From
                <input
                  className="field"
                  type="month"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                To
                <input
                  className="field"
                  type="month"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            const u = username.trim()
            if (!u) {
              setError(copy.browseHint)
              return
            }
            router.push(`/u/${encodeURIComponent(u)}`)
          }}
        >
          {copy.browseToggle}
        </button>
      </form>

      <Ticker />
      <p>
        <Link href="/leaderboard">{copy.leaderboard}</Link>
      </p>
      <footer className="footer">
        Powered by Stockfish. Open source. <Link href="/about">About</Link>
      </footer>
    </main>
  )
}

// The global ticker: live positions-judged count from the metrics item.
// Counts up ease-out over ~800ms on first reveal only; later updates snap,
// and tabular-nums means a changing number never shifts layout.
function Ticker() {
  const [shown, setShown] = useState<number | null>(null)
  const target = useRef<number | null>(null)

  useEffect(() => {
    let stop = false
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    async function poll() {
      const n = await getPositionsJudged()
      if (stop || n === null) return
      if (target.current === null && !reduced && n > 0) {
        const t0 = performance.now()
        const animate = (t: number) => {
          const k = Math.min(1, (t - t0) / 800)
          setShown(Math.round(n * (1 - Math.pow(1 - k, 3))))
          if (k < 1 && !stop) raf = requestAnimationFrame(animate)
        }
        raf = requestAnimationFrame(animate)
      } else {
        setShown(n)
      }
      target.current = n
    }

    void poll()
    const iv = setInterval(poll, 5000)
    return () => {
      stop = true
      clearInterval(iv)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <p className="mono ticker">
      {shown === null ? ' ' : copy.ticker(shown.toLocaleString('en-US'))}
    </p>
  )
}
