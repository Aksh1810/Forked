import { expect, test } from 'vitest'
import { outcomeFor, playerColor } from '../src/player.js'

const sides = { white: { name: 'MagnusCarlsen' }, black: { name: 'hikaru' } }

test('player color matches either side regardless of casing', () => {
  expect(playerColor(sides, 'magnuscarlsen')).toBe('white')
  expect(playerColor(sides, 'MAGNUSCARLSEN')).toBe('white')
  expect(playerColor(sides, 'Hikaru')).toBe('black')
  expect(playerColor(sides, '  hikaru  ')).toBe('black')
})

test('player color is null when the user is not in the game', () => {
  expect(playerColor(sides, 'someone_else')).toBeNull()
  // A pasted PGN has no user at all; it must not match the '?' placeholder
  // name that ingest fills in for an unreadable game.
  expect(playerColor(sides, null)).toBeNull()
  expect(playerColor(sides, '')).toBeNull()
  expect(playerColor({ white: { name: '?' }, black: { name: '?' } }, null)).toBeNull()
})

test('outcome reads the result from the given side', () => {
  expect(outcomeFor('1-0', 'white')).toBe('w')
  expect(outcomeFor('1-0', 'black')).toBe('l')
  expect(outcomeFor('0-1', 'black')).toBe('w')
  expect(outcomeFor('0-1', 'white')).toBe('l')
})

test('draws are draws for both sides; unfinished and colorless are unknown', () => {
  expect(outcomeFor('1/2-1/2', 'white')).toBe('d')
  expect(outcomeFor('1/2-1/2', 'black')).toBe('d')
  // A draw stays a draw even with no color — nobody won it.
  expect(outcomeFor('1/2-1/2', null)).toBe('d')
  expect(outcomeFor('*', 'white')).toBe('?')
  expect(outcomeFor('1-0', null)).toBe('?')
})
