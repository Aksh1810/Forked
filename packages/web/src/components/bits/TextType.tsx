'use client'

import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from './reducedMotion'

// Typewriter for a single line of text; retypes whenever `text` changes. The
// container reserves height (CSS min-height) so variable line lengths never
// reflow the page. Reduced motion renders the full line immediately.
export function TextType({
  text,
  speedMs = 28,
  className,
}: {
  text: string
  speedMs?: number
  className?: string
}) {
  const [shown, setShown] = useState('')
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      setShown(text)
      return
    }
    setShown('')
    let i = 0
    const iv = setInterval(() => {
      i++
      setShown(text.slice(0, i))
      if (i >= text.length) clearInterval(iv)
    }, speedMs)
    return () => clearInterval(iv)
  }, [text, speedMs, reduced])

  return (
    <span className={`bits-texttype${className ? ` ${className}` : ''}`}>
      {/* J4: the retyping animation is presentational only — a screen reader
          gets the full line up front instead of character-by-character. */}
      <span aria-hidden>
        {shown}
        {!reduced && <span className="bits-texttype-cursor">_</span>}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  )
}
