'use client'

import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, usePrefersReducedMotion } from './reducedMotion'

// IntersectionObserver reveal: fades (and optionally blurs) children in the
// first time the wrapper enters the viewport, then unobserves. Reduced
// motion skips the observer entirely and renders fully visible immediately.
export function FadeContent({
  blur = false,
  // C1: entrances never hide content — the pre-reveal state is dim, not
  // invisible, and settles faster.
  duration = 300,
  delay = 0,
  threshold = 0.1,
  initialOpacity = 0.6,
  className,
  children,
}: {
  blur?: boolean
  duration?: number
  delay?: number
  threshold?: number
  initialOpacity?: number
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          obs.unobserve(el)
        }
      },
      { threshold },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])

  // Reduced motion renders a plain div — no transition styles at all, so the
  // CSS reduced-motion block no longer needs a !important override for this.
  if (reduced) {
    return (
      <div ref={ref} className={`bits-fade${className ? ` ${className}` : ''}`}>
        {children}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={`bits-fade${className ? ` ${className}` : ''}`}
      style={{
        opacity: visible ? 1 : initialOpacity,
        filter: blur ? (visible ? 'blur(0px)' : 'blur(8px)') : undefined,
        transitionProperty: blur ? 'opacity, filter' : 'opacity',
        transitionDuration: `${duration}ms`,
        transitionDelay: `${delay}ms`,
        transitionTimingFunction: 'ease',
      }}
    >
      {children}
    </div>
  )
}
