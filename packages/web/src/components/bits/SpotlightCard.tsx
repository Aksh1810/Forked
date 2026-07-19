'use client'

import { useRef } from 'react'

// Wraps existing card markup (className is pass-through so `.panel` styling
// is preserved) and tracks the cursor into --mouse-x/--mouse-y; the actual
// glow is a plain ::before radial-gradient in globals.css, hover-only (the
// spotlight color lives there too — its one source of truth). The rect is
// cached per hover so mousemove never forces a layout read.
export function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const rectRef = useRef<DOMRect | null>(null)

  function handleMouseEnter() {
    rectRef.current = ref.current?.getBoundingClientRect() ?? null
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current
    const rect = rectRef.current
    if (!el || !rect) return
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }

  return (
    <div
      ref={ref}
      className={`bits-spotlight${className ? ` ${className}` : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        rectRef.current = null
      }}
    >
      {children}
    </div>
  )
}
