'use client'

import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './reducedMotion'

// Magnetic pull: the child drifts toward the pointer while it is within
// `padding` px of the wrapper, and springs back on leave. Pointer-driven only
// (no idle cost); hover-capable pointers only, and inert under reduced motion.
// The transform is written straight to the inner div (no state) so pointer
// events never re-render the wrapped subtree; the rect is cached per hover.
export function Magnet({
  children,
  padding = 40,
  strength = 8,
}: {
  children: React.ReactNode
  padding?: number
  strength?: number
}) {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const activeRef = useRef(false)
  useEffect(() => {
    // I2: touch fires pointermove on drag/scroll, not proximity — decided
    // once on mount, matchMedia never runs per event.
    activeRef.current =
      window.matchMedia('(hover: hover) and (pointer: fine)').matches && !prefersReducedMotion()
  }, [])

  function setTransform(x: number, y: number, springBack: boolean) {
    const el = innerRef.current
    if (!el) return
    el.style.transition = springBack
      ? 'transform 300ms cubic-bezier(0.3, 1.4, 0.5, 1)'
      : 'transform 80ms linear'
    el.style.transform = `translate(${x}px, ${y}px)`
  }

  function onEnter(e: React.PointerEvent) {
    if (!activeRef.current) return
    rectRef.current = e.currentTarget.getBoundingClientRect()
  }

  function onMove(e: React.PointerEvent) {
    const rect = rectRef.current
    if (!activeRef.current || !rect) return
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    if (Math.abs(dx) < rect.width / 2 + padding && Math.abs(dy) < rect.height / 2 + padding) {
      setTransform(dx / strength, dy / strength, false)
    }
  }

  function onLeave() {
    rectRef.current = null
    setTransform(0, 0, true)
  }

  return (
    <div onPointerEnter={onEnter} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
