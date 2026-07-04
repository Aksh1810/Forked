import { createHash } from 'node:crypto'

// Engine records are content-addressed: the same move list analyzed by the
// same engine version at the same node budget is the same record, regardless
// of which game it came from.
export function cacheKey(uciMoves: readonly string[], engineVersion: string, nodeBudget: number): string {
  return createHash('sha256')
    .update(uciMoves.join(' '))
    .update('\n')
    .update(engineVersion)
    .update('\n')
    .update(String(nodeBudget))
    .digest('hex')
}
