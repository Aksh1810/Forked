'use client'

import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './reducedMotion'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz?!#'

// Scramble-in reveal: characters flicker through random glyphs and resolve
// left to right. The final text renders invisibly underneath to reserve exact
// width/height, with the scramble absolutely positioned over it — zero layout
// shift while glyph widths churn. Reduced motion renders the text directly.
export function Shuffle({
  text,
  durationMs = 700,
  className,
}: {
  text: string
  durationMs?: number
  className?: string
}) {
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text)
      return
    }
    const t0 = performance.now()
    const iv = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / durationMs)
      const resolved = Math.floor(text.length * k)
      let s = text.slice(0, resolved)
      for (let i = resolved; i < text.length; i++) {
        s += text[i] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      setShown(s)
      if (k >= 1) clearInterval(iv)
    }, 40)
    return () => clearInterval(iv)
  }, [text, durationMs])

  return (
    <span className={className} style={{ position: 'relative', display: 'inline-block' }} aria-label={text}>
      <span style={{ visibility: 'hidden' }} aria-hidden>
        {text}
      </span>
      <span style={{ position: 'absolute', inset: 0 }} aria-hidden>
        {shown ?? ''}
      </span>
    </span>
  )
}
