'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { normalizeUsername } from '@forked/shared'
import { copy } from '../copy'
import { getPositionsJudged, postIngest } from '../lib/api'
import { ClickSpark } from '../components/bits/ClickSpark'
import { ShinyText } from '../components/bits/ShinyText'
import { CountUp } from '../components/bits/CountUp'
import { DotGrid } from '../components/bits/DotGrid'
import { SplitText } from '../components/bits/SplitText'
import { Magnet } from '../components/bits/Magnet'
import { FadeContent } from '../components/bits/FadeContent'

export default function Landing() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [pgn, setPgn] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const u = normalizeUsername(username)
    if (!u) {
      setError(copy.browseHint)
      return
    }
    setError(null)
    router.push(`/u/${encodeURIComponent(u)}`)
  }

  async function submitWrapped(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const u = username.trim() ? normalizeUsername(username) : null
    if (username.trim() && !u) {
      setError(copy.browseHint)
      return
    }
    setError(null)
    setBusy(true)
    const res = await postIngest({
      username: u ?? undefined,
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
      <DotGrid />
      {/* D2: ClickSpark wraps only the hero heading now — it used to wrap the
          whole page, so any click anywhere sparked. */}
      <ClickSpark>
        <h1 className="display headline">
          <SplitText text="Do you know why you lose" />
          <span className="qq">??</span>
        </h1>
      </ClickSpark>
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
        <Magnet>
          <button className="cta" type="submit">
            <ShinyText text={copy.cta} />
          </button>
        </Magnet>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {/* D3: plain quiet links — one accent object in the hero (the CTA). */}
        <Link href="/u/erik" className="link-button">
          {copy.demoLink}
        </Link>{' '}
        <button
          type="button"
          className="link-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {copy.wrappedToggle}
        </button>
      </form>
      <p className="quiet">{copy.privacyLine}</p>

      {expanded && (
        <FadeContent blur duration={250}>
        <form onSubmit={submitWrapped} className="expand-row">
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
          <button className="cta" type="submit" disabled={busy}>
            {busy ? copy.ctaBusy : copy.wrappedCta}
          </button>
        </form>
        </FadeContent>
      )}

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
// CountUp itself handles the ease-out-once/snap-after behavior; this just
// keeps polling and hands it the latest value.
function Ticker() {
  const [n, setN] = useState<number | null>(null)

  useEffect(() => {
    let stop = false
    async function poll() {
      // K10: skip the fetch entirely while the tab isn't visible.
      if (document.hidden) return
      const v = await getPositionsJudged()
      if (!stop && v !== null) setN(v)
    }
    void poll()
    const iv = setInterval(poll, 5000)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [])

  return (
    <p className="mono ticker">
      {n === null ? (
        ' '
      ) : (
        <>
          <CountUp to={n} duration={0.8} /> {copy.tickerSuffix}
        </>
      )}
    </p>
  )
}
