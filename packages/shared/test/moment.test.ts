import { describe, it, expect } from 'vitest'
import { momentFor } from '../src/moment.js'
import { ITALIAN, mkGame } from './analyzed-game.js'

// White collapses at ply 9 (d2d3) and never recovers — the loss is carried
// forward so there's no artificial rebound cliff on later plies.
const record = mkGame({
  gameId: 'g-moment',
  uciMoves: ITALIAN,
  userColor: 'white',
  plies: {
    9: { evalAfter: { type: 'cp', value: -600 } },
    10: { evalAfter: { type: 'cp', value: -600 } },
    11: { evalAfter: { type: 'cp', value: -600 } },
    12: { evalAfter: { type: 'cp', value: -600 } },
  },
}).record

describe('momentFor', () => {
  it('finds the viewer white blunder', () => {
    const m = momentFor(record, 'white')
    expect(m).not.toBeNull()
    expect(m!.ply).toBe(9)
    expect(m!.playedUci).toBe('d2d3')
    expect(m!.loss).toBeGreaterThanOrEqual(20)
    expect(m!.cliff.length).toBeGreaterThan(1)
    expect(m!.cliff[m!.cliff.length - 1]).toBeLessThan(m!.cliff[0]) // it fell
  })

  it('scopes to the side asked for', () => {
    // Same game: White threw it away, Black never had a collapse.
    expect(momentFor(record, 'black')).toBeNull()
  })

  it('returns null for a clean game (no real collapse)', () => {
    const clean = mkGame({ gameId: 'g-clean', uciMoves: ITALIAN, userColor: 'white' }).record
    expect(momentFor(clean, 'white')).toBeNull()
  })
})
