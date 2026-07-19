import type { Enriched } from '@forked/shared'

// One place for tier -> {color, glyph, word}. Board badges, move-list chips,
// the coach card, and the eval graph all read this map instead of keeping
// their own copies.
// A3: reads the --cls-* custom properties rather than repeating their hex
// values — chart/EvalCliff exports (which read TIER[t].color as plain CSS
// color strings, including into inline SVG fill attributes) work fine with
// var(...) strings, same as everywhere else in this codebase.
export const TIER: Record<Enriched, { color: string; glyph: string; word: string }> = {
  brilliant: { color: 'var(--cls-brilliant)', glyph: '!!', word: 'Brilliant' },
  great: { color: 'var(--cls-great)', glyph: '!', word: 'Great move' },
  best: { color: 'var(--cls-best)', glyph: '★', word: 'Best move' },
  excellent: { color: 'var(--cls-excellent)', glyph: '✓', word: 'Excellent' },
  good: { color: 'var(--cls-good)', glyph: '✓', word: 'Good' },
  book: { color: 'var(--cls-book)', glyph: '📖', word: 'Book move' },
  inaccuracy: { color: 'var(--cls-inaccuracy)', glyph: '?!', word: 'Inaccuracy' },
  mistake: { color: 'var(--cls-mistake)', glyph: '?', word: 'Mistake' },
  miss: { color: 'var(--cls-miss)', glyph: '✗', word: 'Miss' },
  blunder: { color: 'var(--cls-blunder)', glyph: '??', word: 'Blunder' },
  none: { color: 'transparent', glyph: '', word: '' },
}

// The "notable" tiers — worth a graph dot, a move-list filter hit, or a
// jump target for key-moment stepping. Shared so all three stay in sync.
export const KEY_TIERS = new Set<Enriched>(['brilliant', 'great', 'miss', 'inaccuracy', 'mistake', 'blunder'])

// A3: the board's square-tint overlay used to be built by string-appending a
// hex alpha suffix ("66") straight onto TIER[t].color — that only works when
// color is a literal hex, and it's now a var(--cls-*) reference. color-mix
// is the token-safe equivalent; 40% ≈ the old 0x66/255 alpha.
export function tierTint(kind: Enriched): string {
  return `color-mix(in srgb, ${TIER[kind].color} 40%, transparent)`
}

// A small colored circle with a white glyph, used anywhere a tier needs a
// compact badge: the board corner badge, move-list chips, the coach card.
export function TierIcon({ kind, size = 18 }: { kind: Enriched; size?: number }) {
  if (kind === 'none') return null
  const t = TIER[kind]
  return (
    // J1: role="img" + aria-label names the tier for screen readers (title
    // alone is not exposed reliably); glyph is near-black — it reads better
    // across the whole --cls-* range than white did (several of those tiers
    // are light/mid-tone, not just the dark reds).
    <span
      role="img"
      aria-label={t.word}
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
        color: '#0b0c10',
        fontWeight: 700,
        fontSize: size * 0.6,
        lineHeight: 1,
      }}
    >
      {t.glyph}
    </span>
  )
}
