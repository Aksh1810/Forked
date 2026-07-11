import { expect, test } from 'vitest'
import { normalizeUsername } from '../src/username.js'

test('passes through a plain username', () => {
  expect(normalizeUsername('Akshx999')).toBe('Akshx999')
})

test('trims surrounding whitespace', () => {
  expect(normalizeUsername('  name  ')).toBe('name')
})

test('strips one leading @', () => {
  expect(normalizeUsername('@name')).toBe('name')
})

test('extracts the username from a member profile URL', () => {
  expect(normalizeUsername('https://www.chess.com/member/Foo_Bar')).toBe('Foo_Bar')
})

test('extracts the username from a bare member URL with a trailing slash', () => {
  expect(normalizeUsername('chess.com/member/foo/')).toBe('foo')
})

test('extracts the username from a stats URL by taking the last segment', () => {
  expect(normalizeUsername('https://www.chess.com/stats/live/rapid/foo')).toBe('foo')
})

test('rejects a chess.com URL with no usable segment', () => {
  expect(normalizeUsername('https://www.chess.com/')).toBeNull()
})

test('rejects a garbage URL', () => {
  expect(normalizeUsername('https://example.com/not/chess')).toBeNull()
})

test('rejects an empty string', () => {
  expect(normalizeUsername('')).toBeNull()
  expect(normalizeUsername('   ')).toBeNull()
})
