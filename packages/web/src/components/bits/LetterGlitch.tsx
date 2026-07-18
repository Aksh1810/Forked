'use client'

import { useEffect, useRef } from 'react'
import { usePrefersReducedMotion } from './reducedMotion'

// Fixed background of dim glyphs where a few cells mutate per tick. Colors
// lean --line grey with rare accent hits. Renders nothing under reduced
// motion; ticks pause while the tab is hidden.
export function LetterGlitch({
  // B7: two greys only — red dropped from the default mix (it was the "rare
  // accent hit"; the accent belongs to the CTA/blunder now).
  colors = ['#2c2933', '#413e4a'],
  tickMs = 120,
  fontSize = 14,
  opacity = 0.06,
}: {
  colors?: string[]
  tickMs?: number
  fontSize?: number
  opacity?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const enabled = !usePrefersReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!enabled || !canvas || !ctx) return

    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?!#$&'
    const cw = fontSize * 0.9
    const ch = fontSize * 1.4
    let cols = 0
    let rows = 0

    function fill() {
      if (!canvas || !ctx) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      cols = Math.ceil(canvas.width / cw)
      rows = Math.ceil(canvas.height / ch)
      ctx.font = `${fontSize}px monospace`
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) drawCell(c, r)
      }
    }

    function drawCell(c: number, r: number) {
      if (!ctx) return
      ctx.clearRect(c * cw, r * ch, cw, ch)
      // Accent color stays rare: last color has a 4% draw chance.
      const accent = Math.random() < 0.04
      ctx.fillStyle = accent ? colors[colors.length - 1] : colors[Math.floor(Math.random() * (colors.length - 1))]
      ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], c * cw, (r + 0.8) * ch)
    }

    fill()
    const iv = setInterval(() => {
      if (document.hidden) return
      for (let i = 0; i < Math.max(4, (cols * rows) / 120); i++) {
        drawCell(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows))
      }
    }, tickMs)
    // A drag-resize fires dozens of events; coalesce full-grid refills to one
    // per frame.
    let resizeRaf = 0
    const onResize = () => {
      if (resizeRaf) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0
        fill()
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearInterval(iv)
      cancelAnimationFrame(resizeRaf)
      window.removeEventListener('resize', onResize)
    }
  }, [enabled, colors, tickMs, fontSize])

  if (!enabled) return null
  return <canvas ref={canvasRef} className="bits-bg-layer" style={{ opacity }} aria-hidden />
}
