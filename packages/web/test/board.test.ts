import { expect, test } from 'vitest'
import { arrowGeometry, dropAction, squareFromPoint } from '../src/components/Board.js'

const rect = { left: 100, top: 100, width: 400, height: 400 } // 50px squares

test('maps a point to its square, white orientation', () => {
  // top-left square is a8; bottom-right is h1
  expect(squareFromPoint(rect, 101, 101, false)).toBe('a8')
  expect(squareFromPoint(rect, 499, 499, false)).toBe('h1')
  // e-file (col 4), rank 4 (row 4 from top): e4 center
  expect(squareFromPoint(rect, 100 + 4 * 50 + 25, 100 + 4 * 50 + 25, false)).toBe('e4')
})

test('maps a point to its square, flipped', () => {
  expect(squareFromPoint(rect, 101, 101, true)).toBe('h1')
  expect(squareFromPoint(rect, 499, 499, true)).toBe('a8')
})

test('returns null outside the board', () => {
  expect(squareFromPoint(rect, 99, 200, false)).toBeNull()
  expect(squareFromPoint(rect, 200, 501, false)).toBeNull()
})

// FIX 1 / FIX 8: the pointerup drop/degrade-to-click decision. Regression
// coverage for "click e2 to select, then drag e2->e4 silently drops the move."
test('dropAction: drag to a different square is a move', () => {
  expect(dropAction({ downSquare: 'e2', downSelected: true, upSquare: 'e4' })).toBe('move')
  expect(dropAction({ downSquare: 'e2', downSelected: false, upSquare: 'e4' })).toBe('move')
})

test('dropAction: click on an unselected piece does nothing on pointerup (pointerdown already selected it)', () => {
  expect(dropAction({ downSquare: 'e2', downSelected: false, upSquare: 'e2' })).toBe('none')
})

test('dropAction: click on the already-selected square deselects', () => {
  expect(dropAction({ downSquare: 'e2', downSelected: true, upSquare: 'e2' })).toBe('deselect')
})

test('dropAction: drop outside the board does nothing', () => {
  expect(dropAction({ downSquare: 'e2', downSelected: true, upSquare: null })).toBe('none')
  expect(dropAction({ downSquare: 'e2', downSelected: false, upSquare: null })).toBe('none')
})

// Knight moves bend (L-bend, chess.com/lichess convention); straight moves
// stay a plain 2-point line.
test('arrowGeometry: a rook move (straight line) has a 2-point shaft', () => {
  const { shaft } = arrowGeometry('e2', 'e4', false)
  expect(shaft).toHaveLength(2)
})

test('arrowGeometry: a knight move has a 3-point shaft with the elbow on the long (2-square) leg', () => {
  const { shaft } = arrowGeometry('g1', 'f3', false)
  expect(shaft).toHaveLength(3)
  const [p1, elbow, tip] = shaft
  // g1->f3 is 1 file, 2 ranks: the elbow shares g1's file (the vertical,
  // 2-square leg comes first) and f3's rank (the final, 1-square leg).
  expect(elbow.x).toBeCloseTo(p1.x)
  expect(elbow.y).not.toBeCloseTo(p1.y)
  expect(tip.x).not.toBeCloseTo(elbow.x)
})

test('arrowGeometry: the head angle points along the final (short) leg, not straight from origin', () => {
  const { angle } = arrowGeometry('g1', 'f3', false)
  // The final leg elbow->f3 is purely horizontal (same rank), so its angle
  // is 0 or PI — never the diagonal atan2(-2,-1) a straight arrow would use.
  const isHorizontal = Math.abs(angle) < 1e-9 || Math.abs(Math.abs(angle) - Math.PI) < 1e-9
  expect(isHorizontal).toBe(true)
})
