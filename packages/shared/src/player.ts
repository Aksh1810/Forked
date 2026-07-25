// Which side of a game a given user played, and how it ended for them. Both
// questions were previously answered by hand at six call sites across the
// worker, the control plane, and the web app, each with its own casing rule
// and its own idea of what an unfinished game means. They live here now.

export interface Sides {
  white: { name: string }
  black: { name: string }
}

// A game's outcome from one player's point of view. '?' covers an unfinished
// game ('*') and a game the user is not a named player in.
export type Outcome = 'w' | 'l' | 'd' | '?'

// chess.com usernames are case-insensitive, and a PGN header preserves
// whatever casing the player typed, so both sides are folded before matching.
// A null or empty username matches nothing — a pasted PGN has no user.
export function playerColor(sides: Sides, username: string | null): 'white' | 'black' | null {
  const u = username?.trim().toLowerCase()
  if (!u) return null
  if (sides.white.name.toLowerCase() === u) return 'white'
  if (sides.black.name.toLowerCase() === u) return 'black'
  return null
}

export function outcomeFor(result: string, color: 'white' | 'black' | null): Outcome {
  if (result === '1/2-1/2') return 'd'
  if (!color || (result !== '1-0' && result !== '0-1')) return '?'
  return (result === '1-0') === (color === 'white') ? 'w' : 'l'
}
