'use client'

import { useId } from 'react'
import type { CSSProperties } from 'react'

// Self-contained SVG turbulence filter drawn as an absolutely-positioned
// ring at the wrapper's own edges (no padding), so it sits directly on top
// of whatever border the wrapped content already draws. Reduced motion
// swaps it for a plain 1px --line border instead of hiding the edge outright.
export function ElectricBorder({
  // A3: updated to the new --blunder value (SVG filter attrs, not CSS, so
  // this stays a literal hex too).
  color = '#f2555a',
  chaos = 0.1,
  borderRadius = 12,
  style,
  children,
}: {
  color?: string
  chaos?: number
  borderRadius?: number | string
  style?: CSSProperties
  children: React.ReactNode
}) {
  const filterId = `bits-electric-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <div className="bits-electric" style={{ ...style, borderRadius }}>
      <svg className="bits-electric-defs" aria-hidden>
        {/* K3: static turbulence — the SMIL <animate> that used to pulse
            baseFrequency is gone (that ran unconditionally, ignoring
            prefers-reduced-motion). The ring still reads as displaced/
            electric-looking, just no longer animating. */}
        <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency={chaos} numOctaves={2} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={chaos * 40} />
        </filter>
      </svg>
      <div
        className="bits-electric-ring"
        style={{ borderRadius, borderColor: color, filter: `url(#${filterId})` }}
      />
      <div className="bits-electric-glow" style={{ borderRadius, boxShadow: `0 0 16px 1px ${color}55` }} />
      <div className="bits-electric-fallback" style={{ borderRadius }} />
      <div className="bits-electric-content">{children}</div>
    </div>
  )
}
