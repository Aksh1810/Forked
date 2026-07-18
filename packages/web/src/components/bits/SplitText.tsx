'use client'

import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './reducedMotion'

// Per-character rise+fade-in, once on mount. Words stay unbreakable
// (inline-block per word) so the split never changes line wrapping. The
// animation waits for the display font so glyphs don't reflow mid-stagger;
// fonts.ready is raced against a timeout so a stalled font never hides text.
export function SplitText({
  text,
  className,
  staggerMs = 30,
}: {
  text: string
  className?: string
  staggerMs?: number
}) {
  const [state, setState] = useState<'static' | 'hidden' | 'run'>('hidden')

  useEffect(() => {
    if (prefersReducedMotion()) {
      setState('static')
      return
    }
    let stop = false
    void Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 500))]).then(() => {
      if (!stop) setState('run')
    })
    return () => {
      stop = true
    }
  }, [])

  if (state === 'static') return <span className={className}>{text}</span>

  const words = text.split(' ')
  let i = 0
  return (
    <span className={className} aria-label={text}>
      {words.map((word, wi) => (
        <span key={wi} style={{ display: 'inline-block', whiteSpace: 'pre' }} aria-hidden>
          {[...word, ...(wi < words.length - 1 ? [' '] : [])].map((ch, ci) => (
            <span
              key={ci}
              className={state === 'run' ? 'bits-split-char' : undefined}
              // C2: entrances never hide content — chars sit at 0.6 opacity
              // pre-run, not 0 (matches the shared bits-enter keyframe).
              style={{
                display: 'inline-block',
                opacity: 0.6,
                animationDelay: `${i++ * staggerMs}ms`,
              }}
            >
              {ch}
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}
