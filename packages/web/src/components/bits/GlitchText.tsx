// CSS-only glitch: offset copies of the text in --blunder and --muted flicker
// behind the original on hover (see .bits-glitch in globals.css). The copies
// come from data-text so screen readers see the text once.
export function GlitchText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`bits-glitch${className ? ` ${className}` : ''}`} data-text={text}>
      {text}
    </span>
  )
}
