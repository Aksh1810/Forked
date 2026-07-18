import { expect, test } from 'vitest'
import { dropAction, squareFromPoint } from '../src/components/Board.js'

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
