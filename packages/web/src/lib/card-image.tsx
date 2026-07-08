import { ImageResponse } from 'next/og'
import type { WrappedSummary } from './api'

// Server-rendered shareable card, the same content and tokens as the on-page
// card, laid out with satori-safe flexbox (no CSS grid, no external CSS). Two
// sizes: the 4:5 feed card that is also the OG/Twitter unfurl image, and the
// 9:16 story export for Instagram and TikTok. One renderer so the sizes can
// never drift apart.
const VOID = '#0B0C10'
const BONE = '#E8E4D9'
const MUTED = '#8A8D94'
const LINE = '#262A33'
const BLUNDER = '#E5443D'

export const CARD_SIZES = {
  '4x5': { width: 1080, height: 1350 },
  '9x16': { width: 1080, height: 1920 },
} as const
export type CardSize = keyof typeof CARD_SIZES

// A div-based win% sparkline (satori renders flexbox, not arbitrary SVG paths):
// one bar per point, the steepest drop tinted with the accent.
function Cliff({ series, height }: { series: number[]; height: number }) {
  let dropAt = 1
  let biggest = 0
  for (let i = 1; i < series.length; i++) {
    const d = Math.abs(series[i] - series[i - 1])
    if (d > biggest) {
      biggest = d
      dropAt = i
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, width: '100%' }}>
      {series.map((v, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flex: 1,
            height: `${Math.max(4, (v / 100) * height)}px`,
            background: i === dropAt ? BLUNDER : BONE,
            borderRadius: 3,
          }}
        />
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ color: MUTED, fontSize: 26 }}>{label}</span>
      <span style={{ color: BONE, fontSize: 56, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

export function renderCard(w: WrappedSummary, size: CardSize, origin: string): ImageResponse {
  const dim = CARD_SIZES[size]
  const url = `${origin.replace(/^https?:\/\//, '')}/j/${w.username ?? ''}`.replace(/\/$/, '')
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: VOID,
          color: BONE,
          padding: 72,
          justifyContent: size === '9x16' ? 'center' : 'flex-start',
          gap: 36,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 34, letterSpacing: 4, fontWeight: 700 }}>FORKED</span>
          {w.username && <span style={{ fontSize: 30, color: MUTED }}>@{w.username}</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: MUTED, fontSize: 28 }}>Archetype</span>
          <span style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
            {w.archetype.name} <span style={{ color: BLUNDER }}>{w.archetype.mark}</span>
          </span>
          <span style={{ color: MUTED, fontSize: 34 }}>{w.archetype.description}</span>
        </div>

        <div style={{ display: 'flex', gap: 64 }}>
          <Stat label="Accuracy" value={w.accuracy !== null ? w.accuracy.toFixed(1) : '--'} />
          <Stat label="Positions judged" value={w.totalPositions.toLocaleString('en-US')} />
        </div>

        {w.worstBlunder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ color: MUTED, fontSize: 26 }}>
              Worst move: {w.worstBlunder.move} <span style={{ color: BLUNDER }}>??</span>
            </span>
            <Cliff series={w.worstBlunder.cliff} height={120} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 64, flexWrap: 'wrap' }}>
          {w.poisonOpening && (
            <Stat label="Poison opening" value={`${w.poisonOpening.family} ${w.poisonOpening.multiplier}x`} />
          )}
          {w.timePressure.dropPct !== null && (
            <Stat label="Under 30s" value={`-${w.timePressure.dropPct.toFixed(1)}%`} />
          )}
        </div>

        <div style={{ display: 'flex', marginTop: 'auto', color: MUTED, fontSize: 26, borderTop: `1px solid ${LINE}`, paddingTop: 24 }}>
          {url}
        </div>
      </div>
    ),
    dim,
  )
}
