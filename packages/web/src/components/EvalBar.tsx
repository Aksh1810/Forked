import { whiteWinPct, type Eval } from '@forked/shared'

// A vertical eval bar sitting flush against the board. The parent flex row
// (align-items: stretch) gives it the board's rendered height. White fill
// share comes straight from whiteWinPct; the page resolves which Eval to show
// (there is no "no eval" state here — it always renders a non-null Eval).
export function formatEval(ev: Eval): string {
  if (ev.type === 'mate') return `M${Math.abs(ev.value)}`
  const v = ev.value / 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

export function EvalBar({ ev, flip, height }: { ev: Eval; flip: boolean; height?: string }) {
  const white = whiteWinPct(ev)
  const whiteWinning = white >= 50
  const label = formatEval(ev)
  // The label sits inside the winning side, at that side's outer edge. White
  // renders at the bottom (top when the board is flipped).
  const labelAtTop = whiteWinning === flip

  return (
    <div
      className="game-eval-bar mono"
      style={{ height, flexDirection: flip ? 'column-reverse' : 'column' }}
      role="img"
      aria-label={`evaluation ${label}`}
    >
      <div className="game-eval-bar-black" style={{ height: `${100 - white}%` }} />
      <div className="game-eval-bar-white" style={{ height: `${white}%` }} />
      <span
        className="game-eval-bar-label"
        // A3: matches --eval-dark/--eval-light, the same tokens the fill
        // bars below use — the label sits inside the winning side's fill.
        style={{
          ...(labelAtTop ? { top: 3 } : { bottom: 3 }),
          color: whiteWinning ? 'var(--eval-dark)' : 'var(--eval-light)',
        }}
      >
        {label}
      </span>
    </div>
  )
}
