'use client'

import { useEffect, useState } from 'react'
import { copy } from '../copy'
import { usePrefersReducedMotion } from './bits/reducedMotion'

// One-shot end-of-game flourish shown when the reviewed position is the
// terminal checkmate: confetti + "You won" on a win, a somber vignette +
// "Checkmated" on a loss (chess.com-style). Fixed, pointer-events:none, so it
// never blocks the board; auto-dismisses. Renders nothing under reduced
// motion — it's pure celebration, not information (the coach card already
// states the outcome).
const CONFETTI_COLORS = ['#ece7e1', '#5fb877', '#e8c547', '#f2555a', '#61b3dc']

export function CheckmateFx({ outcome }: { outcome: 'win' | 'loss' }) {
  const reduced = usePrefersReducedMotion()
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), outcome === 'win' ? 3400 : 2600)
    return () => clearTimeout(t)
  }, [outcome])

  if (!visible) return null

  // Under reduced motion: same win/loss cue, but static — no confetti, no
  // entrance animation (the .fx-static class disables the keyframes).
  const cls = reduced ? ' fx-static' : ''

  if (outcome === 'loss') {
    return (
      <div className={`fx-overlay fx-loss${cls}`} aria-hidden>
        <div className="fx-loss-vignette" />
        <div className="fx-loss-text display">{copy.coach.endLoss}</div>
      </div>
    )
  }

  if (reduced) {
    return (
      <div className="fx-overlay fx-win fx-static" aria-hidden>
        <div className="fx-win-text display">{copy.coach.endWin}</div>
      </div>
    )
  }

  // Confetti: deterministic-enough spread; index-varied so pieces don't stack.
  const pieces = Array.from({ length: 60 }, (_, i) => {
    const left = (i * 37) % 100
    const delay = (i % 12) * 0.09
    const dur = 2.6 + ((i * 13) % 12) / 10
    const spin = 540 + ((i * 71) % 540)
    const drift = ((i % 7) - 3) * 6
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    const w = 6 + (i % 3) * 2
    return (
      <span
        key={i}
        className="fx-confetti"
        style={{
          left: `${left}%`,
          width: w,
          height: w * 1.6,
          background: color,
          animationDelay: `${delay}s`,
          animationDuration: `${dur}s`,
          // custom props consumed by the keyframe
          ['--spin' as string]: `${spin}deg`,
          ['--drift' as string]: `${drift}vw`,
        }}
      />
    )
  })

  return (
    <div className="fx-overlay fx-win" aria-hidden>
      {pieces}
      <div className="fx-win-text display">{copy.coach.endWin}</div>
    </div>
  )
}
