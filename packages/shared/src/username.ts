const USERNAME_RE = /^[a-zA-Z0-9_-]{1,50}$/

// Accepts a bare chess.com username, an @-prefixed handle, or a pasted
// chess.com profile/stats URL, and returns the bare username (case as
// entered) or null if nothing valid can be pulled out. Used on both the
// browse and Wrapped forms so people can paste whatever they have copied.
export function normalizeUsername(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('@')) s = s.slice(1)

  if (/chess\.com/i.test(s)) {
    const path = s
      .replace(/^https?:\/\//i, '')
      .split(/[?#]/)[0]
      .replace(/\/+$/, '')
    const segments = path.split('/').filter(Boolean)
    const memberIdx = segments.findIndex((seg) => seg.toLowerCase() === 'member')
    s = memberIdx >= 0 ? (segments[memberIdx + 1] ?? '') : (segments[segments.length - 1] ?? '')
  }

  return USERNAME_RE.test(s) ? s : null
}
