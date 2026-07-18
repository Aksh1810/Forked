// Pure CSS background-clip shine sweep over text; no hooks, so this can stay
// a server component even though it lives next to client ones in bits/.
export function ShinyText({
  text,
  speed = 3,
  className,
}: {
  text: string
  speed?: number
  className?: string
}) {
  return (
    <span
      className={`bits-shiny${className ? ` ${className}` : ''}`}
      style={{ animationDuration: `${speed}s` }}
    >
      {text}
    </span>
  )
}
