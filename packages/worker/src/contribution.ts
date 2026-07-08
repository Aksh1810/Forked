import {
  finalStatus,
  gameAggContribution,
  gamePhases,
  matchOpening,
  openingFamily,
  type EngineRecord,
  type GameItem,
  type RingEntry,
} from '@forked/shared'

// Builds the completion payload (ring entry plus partial-aggregate
// contribution) for a successfully analyzed game. Shared by the worker's
// message path and by ingest-side cache-hit completions, so a cache hit and
// a fresh analysis account identically.
export function buildDoneOutcome(
  game: Pick<GameItem, 'gameId' | 'uciMoves' | 'userColor'> & {
    game: {
      eco: string | null
      openingName: string | null
      white: { name: string }
      black: { name: string }
      result: string
    }
  },
  record: EngineRecord,
  attempts: number,
): { ringEntry: RingEntry; contribution: ReturnType<typeof gameAggContribution>; attempts: number; kind: 'done' } {
  const terminal = finalStatus(game.uciMoves)
  const bookPlies = matchOpening(game.uciMoves)?.plies ?? 0
  const phases = gamePhases(game.uciMoves, bookPlies)
  const family = openingFamily(game.game.eco, game.game.openingName)
  const contribution = gameAggContribution(record, phases, terminal, game.userColor, family)
  // Chips are from the user's perspective; a PGN-paste job with no matched
  // username falls back to White's.
  const color = game.userColor ?? 'white'
  const won = game.game.result === (color === 'white' ? '1-0' : '0-1')
  const lost = game.game.result === (color === 'white' ? '0-1' : '1-0')
  return {
    kind: 'done',
    attempts,
    contribution,
    ringEntry: {
      gameId: game.gameId,
      accuracy: contribution.accuracy,
      finishedAt: new Date().toISOString(),
      opp: color === 'white' ? game.game.black.name : game.game.white.name,
      res: won ? 'w' : lost ? 'l' : game.game.result === '1/2-1/2' ? 'd' : '?',
      plies: record.plies.length,
    },
  }
}
