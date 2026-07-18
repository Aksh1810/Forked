'use client'

import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './reducedMotion'

interface Spark {
  x: number
  y: number
  angle: number
  startTime: number
}

// Canvas overlay: a burst of short radial lines at each click inside the
// wrapper. The canvas sits above the content but ignores pointer events, so
// clicks land on the real children first and bubble up to the wrapper's
// listener. The rAF loop only runs while sparks are alive.
export function ClickSpark({
  // A3: canvas can't resolve var() cheaply per-frame, so this stays a literal
  // hex — updated to the new --blunder value.
  sparkColor = '#f2555a',
  sparkSize = 10,
  sparkRadius = 15,
  sparkCount = 8,
  duration = 400,
  extraScale = 1,
  children,
}: {
  sparkColor?: string
  sparkSize?: number
  sparkRadius?: number
  sparkCount?: number
  duration?: number
  extraScale?: number
  children: React.ReactNode
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sparksRef = useRef<Spark[]>([])
  const rafRef = useRef(0)
  const reducedRef = useRef(false)

  useEffect(() => {
    reducedRef.current = prefersReducedMotion()
  }, [])

  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!wrapper || !canvas || !ctx) return

    function resize() {
      if (!canvas || !wrapper) return
      canvas.width = wrapper.clientWidth
      canvas.height = wrapper.clientHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapper)

    function draw(timestamp: number) {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      sparksRef.current = sparksRef.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime
        if (elapsed >= duration) return false
        const progress = elapsed / duration
        const eased = 1 - Math.pow(1 - progress, 2)
        const distance = eased * sparkRadius * extraScale
        const lineLength = sparkSize * (1 - eased)
        const x1 = spark.x + distance * Math.cos(spark.angle)
        const y1 = spark.y + distance * Math.sin(spark.angle)
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle)
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle)
        ctx.strokeStyle = sparkColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        return true
      })
      rafRef.current = sparksRef.current.length > 0 ? requestAnimationFrame(draw) : 0
    }

    function handleClick(e: MouseEvent) {
      if (reducedRef.current || !canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const now = performance.now()
      for (let i = 0; i < sparkCount; i++) {
        sparksRef.current.push({ x, y, angle: (2 * Math.PI * i) / sparkCount, startTime: now })
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(draw)
    }

    wrapper.addEventListener('click', handleClick)
    return () => {
      wrapper.removeEventListener('click', handleClick)
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [sparkColor, sparkSize, sparkRadius, sparkCount, duration, extraScale])

  return (
    <div ref={wrapperRef} className="bits-spark-wrap">
      <canvas ref={canvasRef} className="bits-spark-canvas" aria-hidden />
      {children}
    </div>
  )
}
