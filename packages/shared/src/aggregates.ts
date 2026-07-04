import { gameAccuracies } from './accuracy.js'
import type { GamePhase } from './phases.js'
import type { RingEntry } from './jobs.js'
import type { EngineRecord } from './schemas.js'

// Product-facing opening family: the part of the lichess opening name before
// the colon ("Sicilian Defense: Najdorf Variation" -> "Sicilian Defense"),
// falling back to the ECO letter bucket, then Unknown.
export function openingFamily(eco: string | null, openingName: string | null): string {
  if (openingName) return openingName.split(':')[0].trim()
  if (eco) return `ECO ${eco[0]}`
  return 'Unknown'
}

export interface GameAggContribution {
  family: string
  accuracy: number | null
  moves: number
  blunders: number
  phaseMoves: Partial<Record<GamePhase, number>>
  phaseBlunders: Partial<Record<GamePhase, number>>
}

// The user's contribution of one completed game to the job's partial
// aggregates. Only the user's own classified (non-book) moves count.
export function gameAggContribution(
  record: Pick<EngineRecord, 'startEval' | 'plies'>,
  phases: readonly GamePhase[],
  terminal: 'checkmate' | 'stalemate' | null,
  userColor: 'white' | 'black' | null,
  family: string,
): GameAggContribution {
  const contribution: GameAggContribution = {
    family,
    accuracy: null,
    moves: 0,
    blunders: 0,
    phaseMoves: {},
    phaseBlunders: {},
  }
  if (!userColor) return contribution
  contribution.accuracy = gameAccuracies(record, terminal)[userColor]
  for (const p of record.plies) {
    const mover = p.ply % 2 === 1 ? 'white' : 'black'
    if (mover !== userColor || p.book) continue
    const phase = phases[p.ply - 1]
    contribution.moves += 1
    contribution.phaseMoves[phase] = (contribution.phaseMoves[phase] ?? 0) + 1
    if (p.classification === 'blunder') {
      contribution.blunders += 1
      contribution.phaseBlunders[phase] = (contribution.phaseBlunders[phase] ?? 0) + 1
    }
  }
  return contribution
}

// Last-20 ring merge. Under concurrent completions an entry can be lost to a
// read-modify-write race; that is acceptable for a progress ticker, and the
// finalizer recomputes all real numbers from the game items.
export function mergeRing(ring: readonly RingEntry[], entry: RingEntry, cap = 20): RingEntry[] {
  return [...ring, entry].slice(-cap)
}
