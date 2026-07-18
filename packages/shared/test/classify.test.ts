import { expect, test } from 'vitest'
import { classifyLive, classifyWinPctSwing, enrichClassifications, moveMotif, turningPoint } from '../src/classify.js'
import type { Eval, EngineRecord, PlyAnalysis } from '../src/schemas.js'
import { winPctFromCp } from '../src/win.js'
import { ITALIAN } from './analyzed-game.js'

// Binary search over winPctFromCp (monotonic in cp) to build an Eval that
// hits an exact white win% target, so blunder-gate tests can assert on the
// same round numbers the spec describes (e.g. "60 -> 28") instead of
// hand-derived centipawn values.
function cpForWhiteWinPct(target: number): number {
  let lo = -3000
  let hi = 3000
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (winPctFromCp(mid) < target) lo = mid
    else hi = mid
  }
  return Math.round((lo + hi) / 2)
}

// [wpBefore, wpAfter, expected, note] — WintrChess reference bands: inaccuracy
// >=8, mistake >=12, blunder >=22 (was 10/20/30; the old bands ran a whole
// tier too lenient vs chess.com's CAPS2 on the same game).
const CASES: [number, number, string, string][] = [
  [50, 15, 'blunder', 'loss of 35'],
  [50, 27.9, 'blunder', 'loss of exactly 22.1 (blunder edge)'],
  [50, 28.1, 'mistake', 'loss of exactly 21.9 (just under blunder edge)'],
  [50, 45, 'none', 'loss of 5'],
  [50, 37.9, 'mistake', 'loss of exactly 12.1 (mistake edge)'],
  [50, 38.1, 'inaccuracy', 'loss of exactly 11.9 (just under mistake edge)'],
  [50, 41.9, 'inaccuracy', 'loss of exactly 8.1 (inaccuracy edge)'],
  [50, 42.1, 'none', 'loss of exactly 7.9 (just under inaccuracy edge)'],
  [50, 70, 'none', 'gaining is never classified'],
  [95, 80, 'none', 'decided position, loss suppressed'],
  [91, 61, 'none', 'decided position, 30-point loss suppressed above the 40 line'],
  [95, 35, 'blunder', 'throw-away: 60+ down to 40- overrides suppression'],
  [100, 30, 'blunder', 'mate for the mover thrown away to losing'],
  [65, 45, 'mistake', 'loss of 20, near the throw-away zone but not decided (65 < 90)'],
  [60, 40, 'mistake', 'exactly 60 to exactly 40, loss of 20'],
  [9, 0, 'none', 'already lost, nothing left to lose'],
  [100, 95, 'none', 'mate to still winning, suppressed'],
  [0, 0, 'none', 'dead lost throughout'],
]

test.each(CASES)('before %f after %f is %s (%s)', (before, after, expected) => {
  expect(classifyWinPctSwing(before, after)).toBe(expected)
})

// --- enrichClassifications ---

const cp = (value: number): Eval => ({ type: 'cp', value })

function ply(overrides: Partial<PlyAnalysis> & Pick<PlyAnalysis, 'ply' | 'played'>): PlyAnalysis {
  return {
    best: overrides.played,
    pv: [overrides.played],
    evalAfter: cp(0),
    classification: 'none',
    book: false,
    ...overrides,
  }
}

function mkRecord(uciMoves: string[], startEval: Eval, plies: PlyAnalysis[]): EngineRecord {
  return {
    cacheKey: 'test',
    engineVersion: 'Stockfish 18',
    nodeBudget: 100_000,
    uciMoves,
    startEval,
    plies,
  }
}

test('book plies pass through as book, regardless of loss', () => {
  const record = mkRecord(
    ['e2e4', 'e7e5'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', book: true, evalAfter: cp(-200) }),
      ply({ ply: 2, played: 'e7e5', book: true }),
    ],
  )
  expect(enrichClassifications(record)[0]).toBe('book')
})

test('playing the engine best move with no punish and no sacrifice is best', () => {
  const record = mkRecord(['e2e4'], cp(0), [ply({ ply: 1, played: 'e2e4', best: 'e2e4', pv: ['e2e4'] })])
  expect(enrichClassifications(record)).toEqual(['best'])
})

test('a small non-best loss under 4.5 win-pts is excellent', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(0),
    [ply({ ply: 1, played: 'e2e4', best: 'd2d4', evalAfter: cp(0) })], // loss 0
  )
  expect(enrichClassifications(record)).toEqual(['excellent'])
})

test('a non-best loss between 4.5 and 8 win-pts is good', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(0),
    [ply({ ply: 1, played: 'e2e4', best: 'd2d4', evalAfter: cp(-60) })], // loss ~5.5
  )
  expect(enrichClassifications(record)).toEqual(['good'])
})

// --- F3: the display tier comes from the recomputed win% swing, never from
// the stored p.classification. That field is only ever a stale snapshot from
// whatever band thresholds were live at analysis time.

test('a genuine 8+ win-pt loss is classified as inaccuracy purely from the swing, even with no stored classification', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(0),
    // startEval 50%, evalAfter targets white ~41% -> loss ~9, inside [8,12).
    [ply({ ply: 1, played: 'e2e4', best: 'd2d4', evalAfter: cp(cpForWhiteWinPct(41)) })],
  )
  expect(enrichClassifications(record)).toEqual(['inaccuracy'])
})

test('a stale stored classification is ignored: a genuinely tiny loss reads as excellent even when p.classification says blunder', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(0),
    // startEval 50%, evalAfter targets white 47% -> loss 3, well under the
    // excellent cutoff. The stored 'blunder' here simulates a game analyzed
    // under an old (looser or since-fixed) threshold set — trusting it
    // instead of the swing would be exactly the D3 staleness bug.
    [ply({ ply: 1, played: 'e2e4', best: 'd2d4', classification: 'blunder', evalAfter: cp(cpForWhiteWinPct(47)) })],
  )
  expect(enrichClassifications(record)).toEqual(['excellent'])
})

test('a stored bad tier is relabeled miss when the opponent just blundered >=20 and the mover was still >=70', () => {
  const record = mkRecord(
    ['e2e4', 'e7e5', 'g1f3'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', evalAfter: cp(0) }),
      // black's reply loses ~31 win-pts, handing white a big edge
      ply({ ply: 2, played: 'e7e5', evalAfter: cp(400) }),
      // white's move (stored as a mistake) is relabeled: white was at 81%
      ply({ ply: 3, played: 'g1f3', best: 'd2d4', classification: 'mistake', evalAfter: cp(0) }),
    ],
  )
  expect(enrichClassifications(record)[2]).toBe('miss')
})

test('the best move after the opponent blundered >=20 is great', () => {
  const record = mkRecord(
    ITALIAN.slice(0, 5),
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4' }),
      ply({ ply: 2, played: 'e7e5' }),
      ply({ ply: 3, played: 'g1f3' }),
      // black blunders ~31 win-pts away
      ply({ ply: 4, played: 'b8c6', evalAfter: cp(400) }),
      // white finds the best move punishing it; no sacrifice pattern (pv has no reply)
      ply({ ply: 5, played: 'f1c4', best: 'f1c4', pv: ['f1c4'], evalAfter: cp(450) }),
    ],
  )
  expect(enrichClassifications(record)[4]).toBe('great')
})

test('a queen sac where the opponent pv recaptures on the destination is brilliant', () => {
  const record = mkRecord(
    ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'h5f7'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4' }),
      ply({ ply: 2, played: 'e7e5' }),
      ply({ ply: 3, played: 'd1h5' }),
      ply({ ply: 4, played: 'b8c6' }),
      // Qxf7: queen (9) takes a pawn (1) on f7, black's expected reply Kxf7
      // recaptures on the same square -> sacrifice, and white stays ahead.
      ply({ ply: 5, played: 'h5f7', best: 'h5f7', pv: ['h5f7', 'e8f7'], evalAfter: cp(200) }),
    ],
  )
  expect(enrichClassifications(record)[4]).toBe('brilliant')
})

// --- en passant / promotion sac-heuristic holes (BUG3) ---

test('en passant capture is not read as a sacrifice: 1.e4 Nf6 2.e5 d5 3.exd6 is best, not brilliant', () => {
  const record = mkRecord(
    ['e2e4', 'g8f6', 'e4e5', 'd7d5', 'e5d6'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', evalAfter: cp(0) }),
      ply({ ply: 2, played: 'g8f6', evalAfter: cp(0) }),
      ply({ ply: 3, played: 'e4e5', evalAfter: cp(0) }),
      ply({ ply: 4, played: 'd7d5', evalAfter: cp(0) }),
      // exd6 e.p.: pawn takes pawn, an even trade — pv's black reply
      // recaptures on the same square d6, which the old capturedValue=0
      // (empty-square) reading misclassified as a free sacrifice.
      ply({ ply: 5, played: 'e5d6', best: 'e5d6', pv: ['e5d6', 'c7d6'], evalAfter: cp(0) }),
    ],
  )
  expect(enrichClassifications(record)[4]).toBe('best')
})

test('a push-promotion best move is not read as a sacrifice', () => {
  const uciMoves = [
    'e2e4', 'e7e5', 'g1f3', 'g8f6', 'f1c4', 'f8c5', 'e1g1', 'e8g8',
    'd2d4', 'e5d4', 'e4e5', 'a7a6', 'e5e6', 'a6a5', 'e6e7', 'a5a4',
    'e7e8q',
  ]
  const record = mkRecord(
    uciMoves,
    cp(0),
    uciMoves.map((played, i) =>
      i < uciMoves.length - 1
        ? ply({ ply: i + 1, played, evalAfter: cp(0) })
        : // e7e8=Q: a push (e8 stood empty since black castled away at ply 8),
          // not a capture. pv's black reply recaptures on e8 — the old
          // capturedValue=0 reading misclassified this push as a sacrifice.
          ply({ ply: i + 1, played, best: played, pv: [played, 'd8e8'], evalAfter: cp(0) }),
    ),
  )
  expect(enrichClassifications(record).at(-1)).toBe('best')
})

// --- turningPoint ---

test('turningPoint returns the ply with the single largest win-pct loss', () => {
  // Eval is always White-perspective; black's ply 2 blunders the position from
  // near-even to a big White edge, which the rest of the game roughly holds.
  const record = mkRecord(
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', evalAfter: cp(10) }), // tiny loss
      ply({ ply: 2, played: 'e7e5', evalAfter: cp(400) }), // black hangs a piece: big loss
      ply({ ply: 3, played: 'g1f3', evalAfter: cp(380) }),
      ply({ ply: 4, played: 'b8c6', evalAfter: cp(390) }),
      ply({ ply: 5, played: 'f1b5', evalAfter: cp(370) }),
      ply({ ply: 6, played: 'a7a6', evalAfter: cp(360) }),
    ],
  )
  expect(turningPoint(record)).toBe(2)
})

test('a quiet game with no loss over 20 win-pts has no turning point', () => {
  const record = mkRecord(
    ['e2e4', 'e7e5', 'g1f3'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', evalAfter: cp(10) }),
      ply({ ply: 2, played: 'e7e5', evalAfter: cp(0) }),
      ply({ ply: 3, played: 'g1f3', evalAfter: cp(15) }),
    ],
  )
  expect(turningPoint(record)).toBeNull()
})

// --- blunder gate (A3) ---

test('a stored blunder that allows mate against the mover stays a blunder', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(0),
    [ply({ ply: 1, played: 'e2e4', best: 'd2d4', classification: 'blunder', evalAfter: { type: 'mate', value: -3 } })],
  )
  expect(enrichClassifications(record)).toEqual(['blunder'])
})

test('a stored blunder with a 32-point swing (60 -> 28) downgrades to a mistake', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(cpForWhiteWinPct(60)),
    [
      ply({
        ply: 1,
        played: 'e2e4',
        best: 'd2d4',
        classification: 'blunder',
        evalAfter: cp(cpForWhiteWinPct(28)),
      }),
    ],
  )
  expect(enrichClassifications(record)).toEqual(['mistake'])
})

test('a stored blunder with a 45-point swing (60 -> 15) stays a blunder', () => {
  const record = mkRecord(
    ['e2e4'],
    cp(cpForWhiteWinPct(60)),
    [
      ply({
        ply: 1,
        played: 'e2e4',
        best: 'd2d4',
        classification: 'blunder',
        evalAfter: cp(cpForWhiteWinPct(15)),
      }),
    ],
  )
  expect(enrichClassifications(record)).toEqual(['blunder'])
})

test('the blunder gate does not touch a relabeled miss', () => {
  const record = mkRecord(
    ['e2e4', 'e7e5', 'g1f3'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', evalAfter: cp(0) }),
      // black's reply loses 35 win-pts (50 -> 15), handing white a big edge.
      ply({ ply: 2, played: 'e7e5', evalAfter: cp(cpForWhiteWinPct(85)) }),
      // white's own move throws away 30 win-pts here (85 -> 55) — on its
      // own that's blunder-band (>=22) and inside the gate's downgrade
      // range (loss<40, wpAfter>15), so IF this ply reached the gate as a
      // plain 'blunder' it would be downgraded to 'mistake'. But
      // prevLoss>=20 and wpBefore>=70 fire the miss-relabel branch first,
      // which wins the tier before the gate ever runs.
      ply({ ply: 3, played: 'g1f3', best: 'd2d4', evalAfter: cp(cpForWhiteWinPct(55)) }),
    ],
  )
  expect(enrichClassifications(record)[2]).toBe('miss')
})

// --- moveMotif (A4) ---

test('moveMotif flags allowed-mate when the move allows a forced mate against the mover', () => {
  const record = mkRecord(['e2e4'], cp(0), [ply({ ply: 1, played: 'e2e4', evalAfter: { type: 'mate', value: -3 } })])
  const enriched = enrichClassifications(record)
  expect(moveMotif(record, enriched)[0]).toEqual({ kind: 'allowed-mate', n: 3 })
})

test('moveMotif flags missed-mate when the mover had a forced mate and played something else', () => {
  const record = mkRecord(
    ['e2e4'],
    { type: 'mate', value: 4 }, // white had mate in 4 before this move
    [ply({ ply: 1, played: 'e2e4', best: 'd2d4', evalAfter: cp(50) })],
  )
  const enriched = enrichClassifications(record)
  expect(moveMotif(record, enriched)[0]).toEqual({ kind: 'missed-mate', n: 4 })
})

test('moveMotif flags hung-piece when the opponent immediately recaptures on the same square', () => {
  // 1. e4 d5 2. exd5 Qxd5 — white's exd5 lands a pawn on d5; black's actual
  // next move recaptures right there.
  const record = mkRecord(
    ['e2e4', 'd7d5', 'e4d5', 'd8d5'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4' }),
      ply({ ply: 2, played: 'd7d5' }),
      ply({ ply: 3, played: 'e4d5', best: 'g1f3', classification: 'blunder', evalAfter: cp(-500) }),
      ply({ ply: 4, played: 'd8d5' }),
    ],
  )
  const enriched = enrichClassifications(record)
  expect(moveMotif(record, enriched)[2]).toEqual({ kind: 'hung-piece', piece: 'pawn' })
})

test('moveMotif flags best-capture when the best move was a capture and the tier is bad', () => {
  // 1. e4 d5 2. exd5 Nf6 — black ignores the free pawn on d5 (Qxd5 was best).
  const record = mkRecord(
    ['e2e4', 'd7d5', 'e4d5', 'g8f6'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4' }),
      ply({ ply: 2, played: 'd7d5' }),
      ply({ ply: 3, played: 'e4d5' }),
      // black 50% -> 30% (loss 20, mistake band): a genuine, internally
      // consistent loss for black (not the old fixture's cp(-450), which
      // was actually a large GAIN for black and only read as 'mistake'
      // because F3-era code trusted the stale classification override
      // instead of the recomputed swing).
      ply({ ply: 4, played: 'g8f6', best: 'd8d5', evalAfter: cp(cpForWhiteWinPct(70)) }),
    ],
  )
  const enriched = enrichClassifications(record)
  expect(moveMotif(record, enriched)[3]).toEqual({ kind: 'best-capture', piece: 'pawn', square: 'd5' })
})

test('moveMotif is null for a quiet best move with nothing notable', () => {
  const record = mkRecord(['e2e4'], cp(0), [ply({ ply: 1, played: 'e2e4', best: 'e2e4' })])
  const enriched = enrichClassifications(record)
  expect(moveMotif(record, enriched)[0]).toBeNull()
})

test('a terminal checkmate ply (evalAfter null) is handled without crashing and does not mask an earlier turning point', () => {
  const record = mkRecord(
    ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'],
    cp(0),
    [
      ply({ ply: 1, played: 'e2e4', evalAfter: cp(10) }),
      ply({ ply: 2, played: 'e7e5', evalAfter: cp(0) }),
      ply({ ply: 3, played: 'd1h5', evalAfter: cp(20) }),
      ply({ ply: 4, played: 'b8c6', evalAfter: cp(10) }),
      ply({ ply: 5, played: 'f1c4', evalAfter: cp(20) }),
      // black blunders into scholar's mate: huge loss for black here
      ply({ ply: 6, played: 'g8f6', evalAfter: cp(900) }),
      // white delivers mate; evalAfter null, scored 100 for white (the mover) -> no loss
      ply({ ply: 7, played: 'h5f7', evalAfter: null }),
    ],
  )
  expect(turningPoint(record)).toBe(6)
})

// --- classifyLive ---
//
// Expected tiers depend on moverWinPct's sigmoid curve, not the raw cp
// values. cp inputs below were picked with a scratch script (binary search
// over winPctFromCp, same approach as cpForWhiteWinPct above) so each loss
// lands squarely inside its intended band rather than near a boundary.

test('classifyLive: playedBest wins regardless of swing', () => {
  expect(classifyLive({ type: 'cp', value: 20 }, { type: 'cp', value: 10 }, 'white', true)).toBe('best')
})

test('classifyLive: tiny loss is excellent, small loss is good', () => {
  // white 54.95 -> 54.04: loss 0.91, under 4.5
  expect(classifyLive({ type: 'cp', value: 54 }, { type: 'cp', value: 44 }, 'white', false)).toBe('excellent')
  // white 54.95 -> 50.00: loss 4.95, between 4.5 and 8
  expect(classifyLive({ type: 'cp', value: 54 }, { type: 'cp', value: 0 }, 'white', false)).toBe('good')
})

test('classifyLive: loss bands map to inaccuracy/mistake', () => {
  // white 50.00 -> 40.01: loss 9.99, in the [8,12) inaccuracy band
  expect(classifyLive({ type: 'cp', value: 0 }, { type: 'cp', value: -110 }, 'white', false)).toBe('inaccuracy')
  // white 50.00 -> 32.38: loss 17.62, in the [12,22) mistake band
  expect(classifyLive({ type: 'cp', value: 0 }, { type: 'cp', value: -200 }, 'white', false)).toBe('mistake')
})

test('classifyLive: catastrophic blunder stays blunder (mate against mover)', () => {
  expect(classifyLive({ type: 'cp', value: 0 }, { type: 'mate', value: -3 }, 'white', false)).toBe('blunder')
})

test('classifyLive: non-catastrophic 30-40pt swing downgrades to mistake (blunder gate)', () => {
  // white 59.99 -> 25.03: loss 34.96 (30-40, non-catastrophic) and wpAfter > 15
  expect(classifyLive({ type: 'cp', value: 110 }, { type: 'cp', value: -298 }, 'white', false)).toBe('mistake')
})

test('classifyLive: black perspective (white-perspective evals negated for the mover)', () => {
  // black mover: cp -54 is 54.95% for black; dropping to cp 0 (50% for black) is a loss of 4.95
  expect(classifyLive({ type: 'cp', value: -54 }, { type: 'cp', value: 0 }, 'black', false)).toBe('good')
})
