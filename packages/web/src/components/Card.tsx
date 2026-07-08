'use client'

import { useState } from 'react'
import type { WrappedSummary } from '../lib/api'
import { share } from '../copy'
import { EvalCliff } from './EvalCliff'

// The shareable card, rendered to match the OG image exactly: void background,
// wordmark, username, archetype and mark, accuracy, worst-blunder sparkline,
// poison opening, time-pressure stat, positions-judged, the URL at the foot,
// --blunder as the only accent. The card is the product; everything else is
// built around making this good.
export function Card({ wrapped, jobId }: { wrapped: WrappedSummary; jobId: string }) {
  const url = typeof window !== 'undefined' ? window.location.origin + `/j/${jobId}` : `/j/${jobId}`
  return (
    <div>
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          margin: '0 auto',
          aspectRatio: '4 / 5',
          background: 'var(--void)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="wordmark">forked</span>
          {wrapped.username && <span className="mono" style={{ color: 'var(--muted)' }}>@{wrapped.username}</span>}
        </div>

        <div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Archetype</div>
          <div className="display" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05 }}>
            {wrapped.archetype.name} <span style={{ color: 'var(--blunder)' }}>{wrapped.archetype.mark}</span>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>{wrapped.archetype.description}</div>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          <Stat label="Accuracy" value={wrapped.accuracy !== null ? wrapped.accuracy.toFixed(1) : '--'} />
          <Stat label="Positions" value={wrapped.totalPositions.toLocaleString('en-US')} />
        </div>

        {wrapped.worstBlunder && (
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Worst move: <span className="mono" style={{ color: 'var(--bone)' }}>{wrapped.worstBlunder.move}</span>{' '}
              <span style={{ color: 'var(--blunder)' }}>??</span>
            </div>
            <EvalCliff series={wrapped.worstBlunder.cliff} width={300} height={56} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {wrapped.poisonOpening && (
            <Stat label="Poison opening" value={`${wrapped.poisonOpening.family} ${wrapped.poisonOpening.multiplier}x`} small />
          )}
          {wrapped.timePressure.dropPct !== null && (
            <Stat label="Under 30s" value={`-${wrapped.timePressure.dropPct.toFixed(1)}%`} small />
          )}
        </div>

        <div style={{ marginTop: 'auto', color: 'var(--muted)', fontSize: 12 }} className="mono">
          {url.replace(/^https?:\/\//, '')}
        </div>
      </div>

      <ShareRow wrapped={wrapped} jobId={jobId} url={url} />
    </div>
  )
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</div>
      <div className="mono" style={{ fontSize: small ? 15 : 26, fontWeight: 500 }}>{value}</div>
    </div>
  )
}

// Share row: on mobile the primary action is the native share sheet (Web Share
// API), sharing the PNG file itself where supported. Fallbacks are download of
// both sizes, copy link, and a pre-filled X post. Every control is a real
// 44px tap target, never hover-only.
function ShareRow({ wrapped, jobId, url }: { wrapped: WrappedSummary; jobId: string; url: string }) {
  const [copied, setCopied] = useState(false)
  // The card image is rendered by the web app (same renderer as the OG unfurl),
  // so a downloaded card and a shared-link preview are byte-identical.
  const cardUrl = (size: '4x5' | '9x16') => `/j/${jobId}/card?size=${size}`

  async function nativeShare() {
    try {
      const res = await fetch(cardUrl('4x5'))
      const blob = await res.blob()
      const file = new File([blob], 'forked.png', { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: share.nativeTitle, text: share.xText(wrapped.archetype.name, url) })
        return
      }
      await navigator.share({ title: share.nativeTitle, text: share.xText(wrapped.archetype.name, url), url })
    } catch {
      // user dismissed the sheet or sharing is unsupported; the fallbacks remain
    }
  }

  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, justifyContent: 'center' }}>
      {canNativeShare && (
        <button className="cta" style={{ width: 'auto', padding: '0 20px' }} onClick={nativeShare}>
          {share.shareNative}
        </button>
      )}
      <a className="chip-button" href={cardUrl('4x5')} download="forked.png">{share.download}</a>
      <a className="chip-button" href={cardUrl('9x16')} download="forked-story.png">{share.downloadStory}</a>
      <button
        className="chip-button"
        onClick={() => {
          void navigator.clipboard?.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? share.copied : share.copyLink}
      </button>
      <a
        className="chip-button"
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(share.xText(wrapped.archetype.name, url))}`}
        target="_blank"
        rel="noreferrer"
      >
        {share.shareX}
      </a>
    </div>
  )
}
