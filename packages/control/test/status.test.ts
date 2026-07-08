import { expect, test } from 'vitest'
import { parseGamePgn } from '@forked/shared'
import { getUserGames } from '../src/status.js'
import type { ArchiveGame, ChessCom } from '../src/chesscom.js'

const PGN = `[White "hero"]
[Black "villain"]
[Result "0-1"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 0-1`

const parsed = parseGamePgn(PGN)
if (!parsed.ok) throw new Error('fixture must parse')

const stub = (months: string[], byMonth: Record<string, ArchiveGame[]>): ChessCom =>
  ({
    listMonths: async () => months,
    monthGames: async (_u: string, m: string) => byMonth[m] ?? [],
  }) as unknown as ChessCom

test('getUserGames defaults to the most recent month with metadata and user color', async () => {
  const g: ArchiveGame = { id: 'x1', endTime: 100, game: parsed, rejection: null }
  const res = await getUserGames(stub(['2024-01', '2024-02'], { '2024-02': [g] }), 'Hero')
  expect(res.month).toBe('2024-02')
  expect(res.months).toEqual(['2024-01', '2024-02'])
  expect(res.games).toHaveLength(1)
  expect(res.games[0]).toMatchObject({ id: 'x1', userColor: 'white', result: '0-1', plies: 6 })
})

test('getUserGames honors a requested month and sorts newest first', async () => {
  const a: ArchiveGame = { id: 'a', endTime: 10, game: parsed, rejection: null }
  const b: ArchiveGame = { id: 'b', endTime: 20, game: parsed, rejection: null }
  const res = await getUserGames(stub(['2024-01'], { '2024-01': [a, b] }), 'hero', '2024-01')
  expect(res.games.map((x) => x.id)).toEqual(['b', 'a'])
})

test('getUserGames surfaces rejected games without a color instead of dropping them', async () => {
  const bad: ArchiveGame = {
    id: 'v1',
    endTime: 50,
    game: null,
    rejection: { code: 'variant', message: 'Variant games (chess960) are not supported.' },
  }
  const res = await getUserGames(stub(['2024-05'], { '2024-05': [bad] }), 'hero')
  expect(res.games).toHaveLength(1)
  expect(res.games[0]).toMatchObject({ id: 'v1', userColor: null })
  expect(res.games[0].rejected).toContain('Variant')
})
