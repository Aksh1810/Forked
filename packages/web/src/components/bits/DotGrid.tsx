'use client'

import { useEffect, useRef } from 'react'
import { usePrefersReducedMotion } from './reducedMotion'

// Fixed full-viewport dot field behind the page. Dots sit at --line and lift
// toward the accent when the pointer nears; the pointer position is smoothed
// with a lerp so the glow trails. Renders nothing under reduced motion.
export function DotGrid({
  baseColor = '#2c2933',
  // B3: bone glow, not red — red stays reserved for the CTA/blunder accent.
  activeColor = '#8f8b86',
  dotSize = 3,
  gap = 24,
  proximity = 120,
  opacity = 1,
}: {
  baseColor?: string
  activeColor?: string
  dotSize?: number
  gap?: number
  proximity?: number
  opacity?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const enabled = !usePrefersReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!enabled || !canvas || !ctx) return

    const base = hexRgb(baseColor)
    const active = hexRgb(activeColor)
    // Pointer starts far offscreen so first paint has no glow.
    const target = { x: -9999, y: -9999 }
    const smooth = { x: -9999, y: -9999 }
    let raf = 0
    let running = true
    let logicalW = window.innerWidth
    let logicalH = window.innerHeight

    // I4: devicePixelRatio scaling so the dots stay crisp on hi-dpi screens —
    // the canvas backing store is dpr-scaled, drawing coordinates stay in
    // logical (CSS) pixels via the matching ctx transform.
    function resize() {
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      logicalW = window.innerWidth
      logicalH = window.innerHeight
      canvas.width = logicalW * dpr
      canvas.height = logicalH * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Two-pass paint: the base grid is one fillStyle + N fillRects (no
    // per-dot math), then only the cells inside the pointer's proximity
    // bounding box get the lerped color/scale treatment.
    function paint() {
      ctx!.clearRect(0, 0, logicalW, logicalH)
      ctx!.fillStyle = baseColor
      for (let y = gap / 2; y < logicalH; y += gap) {
        for (let x = gap / 2; x < logicalW; x += gap) {
          ctx!.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize)
        }
      }
      const x0 = Math.max(gap / 2, smooth.x - proximity)
      const x1 = Math.min(logicalW, smooth.x + proximity)
      const y0 = Math.max(gap / 2, smooth.y - proximity)
      const y1 = Math.min(logicalH, smooth.y + proximity)
      for (let y = Math.ceil((y0 - gap / 2) / gap) * gap + gap / 2; y <= y1; y += gap) {
        for (let x = Math.ceil((x0 - gap / 2) / gap) * gap + gap / 2; x <= x1; x += gap) {
          const d = Math.hypot(x - smooth.x, y - smooth.y)
          const k = Math.max(0, 1 - d / proximity)
          if (k === 0) continue
          const r = Math.round(base[0] + (active[0] - base[0]) * k)
          const g = Math.round(base[1] + (active[1] - base[1]) * k)
          const b = Math.round(base[2] + (active[2] - base[2]) * k)
          ctx!.fillStyle = `rgb(${r},${g},${b})`
          const s = dotSize * (1 + k * 0.6)
          ctx!.fillRect(x - s / 2, y - s / 2, s, s)
        }
      }
    }

    // I4: a device with no real hover (touch) never moves the glow target —
    // the loop would just repaint an identical idle frame forever. Draw the
    // one static frame and skip rAF/pointer listeners entirely.
    if (!window.matchMedia('(hover: hover)').matches) {
      paint()
      const onStaticResize = () => {
        resize()
        paint()
      }
      window.addEventListener('resize', onStaticResize)
      return () => window.removeEventListener('resize', onStaticResize)
    }

    // K2: stop scheduling rAF once the smoothed point has caught up to the
    // target (both axes within half a pixel) — restarted by any handler that
    // moves the target, so the loop only spends cycles while the glow is
    // actually easing toward the pointer.
    function settled() {
      return Math.abs(target.x - smooth.x) < 0.5 && Math.abs(target.y - smooth.y) < 0.5
    }
    function tick() {
      smooth.x += (target.x - smooth.x) * 0.12
      smooth.y += (target.y - smooth.y) * 0.12
      paint()
      raf = settled() ? 0 : requestAnimationFrame(tick)
    }
    function kick() {
      if (raf === 0 && running) raf = requestAnimationFrame(tick)
    }

    function onMove(e: PointerEvent) {
      target.x = e.clientX
      target.y = e.clientY
      kick()
    }
    function onLeave() {
      target.x = -9999
      target.y = -9999
      kick()
    }
    function onResize() {
      resize()
      paint()
    }
    // Pause the loop entirely when the tab is hidden.
    function onVisibility() {
      running = !document.hidden
      if (running) kick()
      else if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    paint()
    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, baseColor, activeColor, dotSize, gap, proximity])

  if (!enabled) return null
  return <canvas ref={canvasRef} className="bits-bg-layer" style={{ opacity }} aria-hidden />
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
