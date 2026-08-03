'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { normalizeUsername } from '@forked/shared'
import { copy } from '../copy'
import { getPositionsJudged } from '../lib/api'
import { poll } from '../lib/poll'
import { ClickSpark } from '../components/bits/ClickSpark'
import { ShinyText } from '../components/bits/ShinyText'
import { CountUp } from '../components/bits/CountUp'
import { LetterGlitch } from '../components/bits/LetterGlitch'
import { SplitText } from '../components/bits/SplitText'
import { Magnet } from '../components/bits/Magnet'

export default function Landing() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

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

  return (
    <main className="flow">
      <LetterGlitch
        colors={['#2b4539', '#61dca3', '#61b3dc']}
        opacity={0.4}
        fontSize={22}
        glyphs="♔♕♖♗♘♙♚♛♜♝♞♟"
      />
      {/* Vignette scrim: the chess-glitch field stays vivid at the edges but
          fades to void behind the hero column so the copy stays readable —
          ambient noise at the periphery, a calm console at the center. */}
      <div className="hero-scrim" aria-hidden />
      {/* D2: ClickSpark wraps only the hero heading now — it used to wrap the
          whole page, so any click anywhere sparked. */}
      <ClickSpark>
        <h1 className="display headline">
          <SplitText text="Do you know why you lose" />
          <span className="qq">??</span>
        </h1>
      </ClickSpark>
      <p className="sub">{copy.sub}</p>

      <div className="hero-panel">
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
      </form>
      <p className="quiet">{copy.privacyLine}</p>
      </div>

      <Ticker />
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

  useEffect(
    () =>
      poll(
        // K10: skip the fetch entirely while the tab isn't visible.
        () => (document.hidden ? Promise.resolve(null) : getPositionsJudged()),
        (v) => {
          if (v !== null) setN(v)
          return 'again'
        },
        () => 5000,
      ),
    [],
  )

  return (
    <p className="mono ticker">
      {n === null ? (
        ' '
      ) : (
        <>
          <span className="live-dot" aria-hidden /> <CountUp to={n} duration={0.8} />{' '}
          {copy.tickerSuffix}
        </>
      )}
    </p>
  )
}
