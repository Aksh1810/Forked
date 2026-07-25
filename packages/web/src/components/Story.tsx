'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { WrappedSummary } from '../lib/api'
import { story, share, delighterLines } from '../copy'
import { Card } from './Card'
import { LetterGlitch } from './bits/LetterGlitch'
import { Shuffle } from './bits/Shuffle'
import { CountUp } from './bits/CountUp'
import { usePrefersReducedMotion } from './bits/reducedMotion'

// The eight-slide story: the anticipation payoff. Tap / click / arrow-key
// advance, progress dots rendered as tiny annotation marks, "Skip to card"
// always visible. Slides advance with a fast spring slide; under
// prefers-reduced-motion slides cut and counts render final values. The final
// beat is the archetype reveal, and the story ends at the card, a flex by
// construction.
export function Story({ wrapped, jobId }: { wrapped: WrappedSummary; jobId: string }) {
  const slides = buildSlides(wrapped, jobId)
  const cardIndex = slides.length - 1
  const [i, setI] = useState(0)
  const reduced = usePrefersReducedMotion()

  const go = useCallback((n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))), [slides.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // J5: a keypress landing in a real control (the "Skip to card" link, a
      // form field on the card slide) must not also advance the slide.
      if ((e.target as HTMLElement).closest('button,a,input,textarea,select')) return
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        go(i + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(i - 1)
      } else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(cardIndex)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, go, cardIndex])

  const onCard = i === cardIndex

  return (
    <main
      className="flow story-main"
      style={{ minHeight: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column', paddingTop: 8 }}
    >
      {/* Calm ambient chess field + center scrim — same identity as the landing
          and analyze screens, dialed down so the story content leads. */}
      <LetterGlitch
        colors={['#2b4539', '#61dca3', '#61b3dc']}
        opacity={0.16}
        fontSize={20}
        glyphs="♔♕♖♗♘♙♚♛♜♝♞♟"
        tickMs={280}
      />
      <div className="ambient-scrim" aria-hidden />

      {/* Segmented story-progress bar (Instagram-story convention): filled for
          seen, bright for the current slide. Each segment is a 44px tap target. */}
      <nav className="story-progress" aria-label="story progress">
        {slides.map((_, n) => (
          <button
            key={n}
            className="story-seg"
            aria-label={`slide ${n + 1}`}
            // J6: aria-current only when actually true.
            aria-current={n === i || undefined}
            onClick={() => go(n)}
          >
            <span className="story-seg-fill" data-state={n < i ? 'done' : n === i ? 'current' : 'todo'} />
          </button>
        ))}
      </nav>

      {/* Advancing surface. A click on the right two-thirds advances, the left
          third goes back, matching a stories UI; buttons inside still work. */}
      <section
        aria-live="polite"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a,button')) return
          const rect = e.currentTarget.getBoundingClientRect()
          go(e.clientX - rect.left < rect.width / 3 ? i - 1 : i + 1)
        }}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 16,
          cursor: onCard ? 'default' : 'pointer',
        }}
      >
        {/* Keyed by slide index so each advance re-runs the entrance
            animation; reduced motion drops the class and slides cut. The card
            is its own framed object; every other slide sits in the story frame
            so it reads as one contained thing, not marooned in the void. */}
        <div key={i} className={reduced ? undefined : 'story-slide-in'}>
          {onCard ? slides[i].node(reduced) : <div className="story-frame">{slides[i].node(reduced)}</div>}
        </div>
      </section>

      <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
        <button className="link-button" onClick={() => go(0)}>
          {story.replay}
        </button>
        {!onCard && (
          <button className="link-button" onClick={() => go(cardIndex)}>
            {story.skipToCard}
          </button>
        )}
        {onCard && (
          <Link className="link-button" href={`/j/${jobId}/breakdown`}>
            {share.breakdown}
          </Link>
        )}
      </footer>
    </main>
  )
}

interface Slide {
  node: (reduced: boolean) => ReactNode
}

function buildSlides(w: WrappedSummary, jobId: string): Slide[] {
  const slides: Slide[] = []
  const H = ({ children }: { children: ReactNode }) => (
    <h2 className="display" style={{ fontSize: 'clamp(1.75rem, 1rem + 4vw, 3rem)', fontWeight: 700, margin: 0 }}>
      {children}
    </h2>
  )
  const kicker = (t: string) => <div style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 13 }}>{t}</div>

  // 1. Scale
  slides.push({
    node: () => (
      <div>
        <H>
          We judged <CountUp to={w.totalPositions} className="mono" /> positions across {w.totalGames} games.
        </H>
        <p className="quiet">{story.scaleSub}</p>
      </div>
    ),
  })

  // 2. Accuracy as identity
  slides.push({
    node: () => (
      <div>
        {kicker(story.accuracyTitle)}
        <div className="mono" style={{ fontSize: 'clamp(3rem, 2rem + 8vw, 6rem)', fontWeight: 500 }}>
          {w.accuracy !== null ? <CountUp to={w.accuracy} decimals={1} /> : '--'}
          <span style={{ fontSize: '0.4em', color: 'var(--muted)' }}>%</span>
        </div>
        <p className="quiet">
          {w.accuracyPercentile !== null ? story.accuracyPercentile(w.accuracyPercentile) : story.accuracyNoPercentile}
        </p>
      </div>
    ),
  })

  // Single-move highlights (best moment / worst blunder) were removed here:
  // across hundreds of games one cherry-picked move doesn't land. That drama
  // now lives per-game in the "Moment you lost" reel, where the move is the
  // whole point. The Wrapped stays about aggregate identity.

  // 3. The poison opening
  slides.push({
    node: () => (
      <div>
        {kicker(story.poisonTitle)}
        {w.poisonOpening ? (
          <>
            <H>{w.poisonOpening.family}</H>
            <p style={{ fontSize: 20 }}>{story.poisonLine(w.poisonOpening.family, w.poisonOpening.multiplier)}</p>
          </>
        ) : (
          <H>You blunder evenly across every opening. Consistency.</H>
        )}
      </div>
    ),
  })

  // 6. Time pressure
  slides.push({
    node: () => (
      <div style={{ display: 'grid', gap: 12 }}>
        {kicker(story.timeTitle)}
        {w.timePressure.dropPct !== null && w.timePressure.dropPct > 0 ? (
          <H>{story.timeLine(w.timePressure.dropPct)}</H>
        ) : (
          <H>{story.timeNoDrop}</H>
        )}
        <BucketChart buckets={w.timePressure.buckets} />
        {w.worstDay && <p className="quiet">{story.worstDayLine(w.worstDay.date, w.worstDay.games)}</p>}
      </div>
    ),
  })

  // 7. The delighter
  slides.push({
    node: () => {
      const d = w.delighter
      const line = d ? renderDelighter(d) : 'Your stats are remarkably ordinary. That is its own achievement.'
      return (
        <div>
          {kicker(story.delighterTitle)}
          <H>{line}</H>
        </div>
      )
    },
  })

  // 8. Archetype reveal
  slides.push({
    node: () => (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' }}>
        {kicker(story.archetypeKicker)}
        <div className="display" style={{ fontSize: 'clamp(2.5rem, 1.5rem + 6vw, 5rem)', fontWeight: 800, lineHeight: 1 }}>
          <Shuffle text={w.archetype.name} />
        </div>
        <div style={{ fontSize: 40, color: 'var(--blunder)' }} className="mono">
          {w.archetype.mark}
        </div>
        <p style={{ fontSize: 20 }}>{w.archetype.description}</p>
        <p className="quiet">{story.toCard} →</p>
      </div>
    ),
  })

  // Card (story ends here).
  slides.push({ node: () => <Card wrapped={w} jobId={jobId} /> })

  return slides
}

function renderDelighter(d: NonNullable<WrappedSummary['delighter']>): string {
  switch (d.kind) {
    case 'longest-game':
      return delighterLines['longest-game'](d.plies, d.opponent)
    case 'most-faced':
      return delighterLines['most-faced'](d.opponent, d.count)
    case 'blundered-square':
      return delighterLines['blundered-square'](d.square, d.count)
    case 'favorite-piece':
      return delighterLines['favorite-piece'](d.piece, d.count)
    case 'comebacks':
      return delighterLines.comebacks(d.count)
  }
}

// Accuracy-by-move-time bars. Scaled against the observed range (not a flat
// 0–100) so the differences between buckets actually read; the % label on each
// bar carries the true value, and the tallest bucket is tinted so the reader's
// eye lands on "you play best when…" without relying on height alone.
function BucketChart({ buckets }: { buckets: WrappedSummary['timePressure']['buckets'] }) {
  const present = buckets.map((b) => b.accuracy).filter((v): v is number => v !== null)
  const hi = present.length ? Math.max(...present) : 100
  const lo = present.length ? Math.min(...present) : 0
  const span = Math.max(1, hi - lo)
  const MIN_H = 28
  const MAX_H = 96
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
      {buckets.map((b) => {
        const isBest = b.accuracy !== null && b.accuracy === hi && present.length > 1
        const h = b.accuracy === null ? 4 : MIN_H + ((b.accuracy - lo) / span) * (MAX_H - MIN_H)
        return (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontSize: 12, color: b.accuracy === null ? 'var(--muted)' : 'var(--bone)' }}>
              {b.accuracy !== null ? `${b.accuracy.toFixed(0)}%` : '—'}
            </span>
            <div
              style={{
                width: '100%',
                height: h,
                background: b.accuracy === null ? 'var(--line)' : isBest ? 'var(--best)' : 'var(--bone)',
                borderRadius: '4px 4px 0 0',
              }}
            />
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{b.label}</span>
          </div>
        )
      })}
    </div>
  )
}

