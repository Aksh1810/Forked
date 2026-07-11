import type { Enriched } from '@forked/shared'

// One place for tier -> {color, glyph, word}. Board badges, move-list chips,
// the coach card, and the eval graph all read this map instead of keeping
// their own copies.
export const TIER: Record<Enriched, { color: string; glyph: string; word: string }> = {
  brilliant: { color: '#26c2a3', glyph: '!!', word: 'Brilliant' },
  great: { color: '#5c8bb0', glyph: '!', word: 'Great move' },
  best: { color: '#81b64c', glyph: '★', word: 'Best move' },
  excellent: { color: '#96bc4b', glyph: '✓', word: 'Excellent' },
  good: { color: '#95af8a', glyph: '✓', word: 'Good' },
  book: { color: '#a88865', glyph: '📖', word: 'Book move' },
  inaccuracy: { color: '#f7c631', glyph: '?!', word: 'Inaccuracy' },
  mistake: { color: '#ffa459', glyph: '?', word: 'Mistake' },
  miss: { color: '#ff7769', glyph: '✗', word: 'Miss' },
  blunder: { color: '#fa412d', glyph: '??', word: 'Blunder' },
  none: { color: 'transparent', glyph: '', word: '' },
}

// The "notable" tiers — worth a graph dot, a move-list filter hit, or a
// jump target for key-moment stepping. Shared so all three stay in sync.
export const KEY_TIERS = new Set<Enriched>(['brilliant', 'great', 'miss', 'inaccuracy', 'mistake', 'blunder'])

// A small colored circle with a white glyph, used anywhere a tier needs a
// compact badge: the board corner badge, move-list chips, the coach card.
export function TierIcon({ kind, size = 18 }: { kind: Enriched; size?: number }) {
  if (kind === 'none') return null
  const t = TIER[kind]
  return (
    <span
      title={t.word}
      style={{
        display: 'inline-flex',
        flex: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: t.color,
        color: '#fff',
        fontWeight: 700,
        fontSize: size * 0.6,
        lineHeight: 1,
      }}
    >
      {t.glyph}
    </span>
  )
}

// A small SVG donut arc showing a 0-100 accuracy number: chess.com-style
// accuracy gauge, pure presentation (no d3, plain stroke-dasharray). Arc
// length is the percentage; color reads the same rough bands as the tier
// colors (green/yellow/red) without depending on Enriched.
export function AccuracyRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, pct))
  const dash = (clamped / 100) * c
  const color = clamped >= 80 ? 'var(--best)' : clamped >= 60 ? 'var(--cls-inaccuracy)' : 'var(--blunder)'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`accuracy ${clamped.toFixed(1)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="mono" fontSize={size * 0.28} fill="var(--bone)">
        {clamped.toFixed(0)}
      </text>
    </svg>
  )
}
