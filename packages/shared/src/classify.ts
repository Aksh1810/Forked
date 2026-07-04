import type { Classification } from './schemas.js'

// Classification is based on the mover's win-probability swing, in percentage
// points: a loss of 30 or more is a blunder, 20 or more a mistake, 10 or more
// an inaccuracy. In already-decided positions (mover below 10 or above 90
// before the move) classification is suppressed, EXCEPT when the move crosses
// from 60 or above down to 40 or below, which throws away a winning position
// and is always flagged.
export function classifyWinPctSwing(wpBefore: number, wpAfter: number): Classification {
  const throwAway = wpBefore >= 60 && wpAfter <= 40
  const decided = wpBefore < 10 || wpBefore > 90
  if (decided && !throwAway) return 'none'
  const loss = wpBefore - wpAfter
  if (loss >= 30) return 'blunder'
  if (loss >= 20) return 'mistake'
  if (loss >= 10) return 'inaccuracy'
  return 'none'
}
