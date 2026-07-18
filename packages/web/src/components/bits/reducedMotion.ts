'use client'

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// One-shot imperative read, for effects/handlers that run once per
// interaction and don't need to react to the OS toggle mid-flight.
export function prefersReducedMotion(): boolean {
  return window.matchMedia(QUERY).matches
}

// Live-updating hook (moved from Story.tsx): persistent layers (ambient
// canvases, the story deck) respond to the OS toggle without a remount.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
