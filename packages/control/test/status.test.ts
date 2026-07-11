import { expect, test } from 'vitest'
import { parseGamePgn } from '@forked/shared'
import { getJobView, getUserGames } from '../src/status.js'
import type { ArchiveGame, ChessCom } from '../src/chesscom.js'
import { fakeDeps } from './fake-deps.js'

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
  expect(res.months).toEqual([])
  expect(res.month).toBe('2024-01')
  expect(res.games.map((x) => x.id)).toEqual(['b', 'a'])
})

test('getUserGames never calls listMonths when a month is given', async () => {
  const a: ArchiveGame = { id: 'a', endTime: 10, game: parsed, rejection: null }
  const throwing: ChessCom = {
    listMonths: async () => {
      throw new Error('listMonths should not be called when month is given')
    },
    monthGames: async (_u: string, m: string) => (m === '2024-03' ? [a] : []),
  } as unknown as ChessCom
  const res = await getUserGames(throwing, 'hero', '2024-03')
  expect(res.months).toEqual([])
  expect(res.games).toHaveLength(1)
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

test('getJobView projects an ETA from observed throughput while analyzing', async () => {
  const createdAt = new Date(Date.now() - 100_000).toISOString() // 100s ago
  const { deps } = fakeDeps(() => ({
    Item: { jobId: 'j1', status: 'analyzing', total: 10, completed: 4, failed: 1, createdAt },
  }))
  const view = await getJobView(deps, 'j1', false)
  // 5 done in ~100s -> 5 remaining projects to ~100s more.
  expect(view?.etaSeconds).toBeGreaterThanOrEqual(98)
  expect(view?.etaSeconds).toBeLessThanOrEqual(102)
})

test('getJobView reports no ETA outside analyzing and before any game finishes', async () => {
  const createdAt = new Date(Date.now() - 100_000).toISOString()
  const { deps: ingesting } = fakeDeps(() => ({
    Item: { jobId: 'j1', status: 'ingesting', total: 10, completed: 0, failed: 0, createdAt },
  }))
  expect((await getJobView(ingesting, 'j1', false))?.etaSeconds).toBeNull()

  const { deps: noneDone } = fakeDeps(() => ({
    Item: { jobId: 'j1', status: 'analyzing', total: 10, completed: 0, failed: 0, createdAt },
  }))
  expect((await getJobView(noneDone, 'j1', false))?.etaSeconds).toBeNull()
})

test('getJobView reports a zero ETA once every game has finished', async () => {
  const createdAt = new Date(Date.now() - 100_000).toISOString()
  const { deps } = fakeDeps(() => ({
    Item: { jobId: 'j1', status: 'analyzing', total: 10, completed: 9, failed: 1, createdAt },
  }))
  expect((await getJobView(deps, 'j1', false))?.etaSeconds).toBe(0)
})
