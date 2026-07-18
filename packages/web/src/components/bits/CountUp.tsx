'use client'

import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './reducedMotion'

// Ease-out numeric count-up, extracted from the original Ticker component
// (src/app/page.tsx). The first value animates over `duration`; every later
// value change tweens briefly (300ms) from the currently shown number so live
// counters roll instead of snapping. Reduced motion always snaps.
export function CountUp({
  to,
  from = 0,
  duration = 0.8,
  delay = 0,
  separator = ',',
  decimals = 0,
  className,
}: {
  to: number
  from?: number
  duration?: number
  delay?: number
  separator?: string
  decimals?: number
  className?: string
}) {
  const [shown, setShown] = useState(from)
  const shownRef = useRef(from)
  const first = useRef(true)
  shownRef.current = shown

  useEffect(() => {
    const reduced = prefersReducedMotion()
    if (reduced) {
      first.current = false
      setShown(to)
      return
    }
    const isFirst = first.current
    first.current = false
    const start = isFirst ? from : shownRef.current
    const ms = (isFirst ? duration : 0.3) * 1000
    let raf = 0
    let stop = false
    const timer = setTimeout(
      () => {
        const t0 = performance.now()
        const animate = (t: number) => {
          const k = Math.min(1, (t - t0) / ms)
          setShown(start + (to - start) * (1 - Math.pow(1 - k, 3)))
          if (k < 1 && !stop) raf = requestAnimationFrame(animate)
        }
        raf = requestAnimationFrame(animate)
      },
      isFirst ? delay * 1000 : 0,
    )
    return () => {
      stop = true
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
    // Each new `to` tweens from whatever is currently shown; shownRef keeps
    // that read out of the dependency list.
  }, [to])

  const formatted = shown
    .toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .replace(/,/g, separator)

  return <span className={className}>{formatted}</span>
}
