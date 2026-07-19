'use client'

import { useState } from 'react'
import { prefersReducedMotion } from './reducedMotion'

interface Item<V extends string> {
  label: string
  value: V
}

// The 8 radial offsets are constants — computed once, not per render.
const PARTICLES = Array.from({ length: 8 }, (_, i) => ({
  gx: `${(Math.cos((i / 8) * 2 * Math.PI) * 26).toFixed(1)}px`,
  gy: `${(Math.sin((i / 8) * 2 * Math.PI) * 26).toFixed(1)}px`,
}))

// Pill filter nav with a one-shot particle burst on selection. Pills keep the
// existing .chip-button styling (className merge) so tokens/tap targets hold;
// the burst is 8 absolutely-positioned dots animated by a CSS keyframe.
// Reduced motion: no particles, plain state swap.
export function GooeyNav<V extends string>({
  items,
  active,
  onSelect,
  className,
  ariaLabel = 'filter',
}: {
  items: Item<V>[]
  active: V
  onSelect: (v: V) => void
  className?: string
  ariaLabel?: string
}) {
  const [burst, setBurst] = useState<{ value: V; key: number } | null>(null)

  function select(v: V) {
    onSelect(v)
    if (!prefersReducedMotion()) {
      setBurst({ value: v, key: Date.now() })
    }
  }

  return (
    <div className={`button-row${className ? ` ${className}` : ''}`} role="group" aria-label={ariaLabel}>
      {items.map((it) => (
        <span key={it.value} className="bits-gooey-slot">
          <button
            className="chip-button"
            aria-pressed={active === it.value}
            onClick={() => select(it.value)}
          >
            {it.label}
          </button>
          {burst?.value === it.value && (
            <span key={burst.key} className="bits-gooey-burst" aria-hidden>
              {PARTICLES.map((pt, i) => (
                <span
                  key={i}
                  className="bits-gooey-particle"
                  // B4: bone only — red is reserved for the CTA/blunder accent.
                  style={{ '--gx': pt.gx, '--gy': pt.gy, background: 'var(--bone)' } as React.CSSProperties}
                />
              ))}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
