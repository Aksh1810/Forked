'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { WrappedSummary } from '../lib/api'
import { story, share, delighterLines } from '../copy'
import { Board } from './Board'
import { Card } from './Card'
import { EvalCliff } from './EvalCliff'
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
      className="flow"
      style={{ minHeight: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column', paddingTop: 8 }}
    >
      {/* Progress dots as annotation marks. Tappable, so navigation is never
          keyboard- or gesture-only. */}
      <nav aria-label="story progress" style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '8px 0' }}>
        {slides.map((_, n) => (
          <button
            key={n}
            aria-label={`slide ${n + 1}`}
            // J6: aria-current only when actually true — aria-current="false"
            // on every other dot is noise a screen reader doesn't need.
            aria-current={n === i || undefined}
            onClick={() => go(n)}
            className="mono"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
              // B6/J6: bone for the active dot, muted (not --line, which
              // fails 3:1) for the rest.
              color: n === i ? 'var(--bone)' : 'var(--muted)',
              fontSize: 14,
            }}
          >
            {n === cardIndex ? '!' : n === i ? '?' : '.'}
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
            animation; reduced motion drops the class and slides cut. */}
        <div key={i} className={reduced ? undefined : 'story-slide-in'}>
          {slides[i].node(reduced)}
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

  // 3. The flex
  slides.push({
    node: () => (
      <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        {kicker(story.flexTitle)}
        {w.flex ? (
          <>
            <Board fen={w.flex.fen} size={260} alt={`your best moment against ${w.flex.opponent}`} />
            <div>
              {w.flex.move && (
                <span className="mono" style={{ fontSize: 20 }}>
                  {w.flex.move} <span style={{ color: 'var(--best)' }}>!</span>{' '}
                </span>
              )}
              <p style={{ margin: '6px 0 0' }}>
                {w.flex.move
                  ? story.flexLine(w.flex.move, oppName(w.flex.opponent))
                  : story.flexGameLine(w.flex.accuracy, oppName(w.flex.opponent))}
              </p>
            </div>
          </>
        ) : (
          <H>Not enough games to crown a best moment. Play more.</H>
        )}
      </div>
    ),
  })

  // 4. The worst blunder
  slides.push({
    node: () => (
      <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        {kicker(story.blunderTitle)}
        {w.worstBlunder ? (
          <>
            <Board fen={w.worstBlunder.fen} size={260} alt="the position before your worst move" />
            <EvalCliff series={w.worstBlunder.cliff} />
            <div>
              <span className="mono" style={{ fontSize: 20 }}>
                {w.worstBlunder.move} <span style={{ color: 'var(--blunder)' }}>??</span>
              </span>
              <p style={{ margin: '6px 0 0' }}>{story.blunderLine(w.worstBlunder.move, w.worstBlunder.lossPct)}</p>
            </div>
          </>
        ) : (
          <H>No real blunders to show. Suspicious.</H>
        )}
      </div>
    ),
  })

  // 5. The poison opening
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

// A placeholder or missing opponent name reads as "an opponent" rather than
// "?" or "undefined" in story copy.
function oppName(name: string): string {
  return name && name !== '?' && name !== 'undefined' ? name : 'an opponent'
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

function BucketChart({ buckets }: { buckets: WrappedSummary['timePressure']['buckets'] }) {
  const max = 100
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 90 }}>
      {buckets.map((b) => (
        <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ height: 60, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div
              style={{
                width: '100%',
                height: `${((b.accuracy ?? 0) / max) * 100}%`,
                background: b.accuracy === null ? 'var(--line)' : 'var(--bone)',
                borderRadius: '3px 3px 0 0',
              }}
              title={b.accuracy !== null ? `${b.accuracy.toFixed(0)}%` : 'no data'}
            />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{b.label}</span>
        </div>
      ))}
    </div>
  )
}

