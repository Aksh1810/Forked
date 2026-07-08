import { expect, test } from 'vitest'
import { makeChessCom, UserNotFoundError } from '../src/chesscom.js'
import { fakeDeps, byName } from './fake-deps.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const SCHOLARS = `[Event "Live Chess"]
[White "attacker"]
[Black "victim"]
[Result "1-0"]
[TimeControl "600"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`

test('serial etiquette: concurrent calls never overlap on the wire', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const fetchFn = (async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 20))
    inFlight -= 1
    return json({ games: [] })
  }) as unknown as typeof fetch
  const { deps } = fakeDeps(() => ({}))
  const cc = makeChessCom(deps, { contactEmail: 'x@y.z', fetchFn })
  const current = new Date().toISOString().slice(0, 7)
  await Promise.all([
    cc.monthGames('u', current),
    cc.monthGames('u', current),
    cc.monthGames('u', current),
  ])
  expect(maxInFlight).toBe(1)
})

test('descriptive user agent with contact email on every request', async () => {
  const agents: string[] = []
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    agents.push(new Headers(init?.headers).get('user-agent') ?? '')
    return json({ archives: ['https://api.chess.com/pub/player/u/games/2024/03'] })
  }) as unknown as typeof fetch
  const { deps } = fakeDeps(() => ({}))
  const cc = makeChessCom(deps, { contactEmail: 'contact@example.com', fetchFn })
  expect(await cc.listMonths('u')).toEqual(['2024-03'])
  expect(agents[0]).toContain('forked')
  expect(agents[0]).toContain('contact@example.com')
})

test('404 maps to UserNotFoundError', async () => {
  const fetchFn = (async () => json({}, 404)) as unknown as typeof fetch
  const { deps } = fakeDeps(() => ({}))
  const cc = makeChessCom(deps, { contactEmail: 'x@y.z', fetchFn })
  await expect(cc.listMonths('ghost')).rejects.toBeInstanceOf(UserNotFoundError)
})

test('completed months come from the cache without touching the network', async () => {
  let fetches = 0
  const fetchFn = (async () => {
    fetches += 1
    return json({ games: [] })
  }) as unknown as typeof fetch
  const cached = [{ id: 'g1', endTime: 1, game: null, rejection: { code: 'x', message: 'x' } }]
  const { deps } = fakeDeps((call) =>
    call.name === 'GetCommand' ? { Item: { games: cached } } : {},
  )
  const cc = makeChessCom(deps, { contactEmail: 'x@y.z', fetchFn })
  expect(await cc.monthGames('u', '2020-01')).toEqual(cached)
  expect(fetches).toBe(0)
})

test('a fresh completed month is fetched once, parsed, and cached; the current month never is', async () => {
  const fetchFn = (async () =>
    json({
      games: [
        { uuid: 'ok1', end_time: 100, rules: 'chess', pgn: SCHOLARS },
        { uuid: 'v1', end_time: 101, rules: 'chess960', pgn: SCHOLARS },
      ],
    })) as unknown as typeof fetch
  const { deps, calls } = fakeDeps(() => ({}))
  const cc = makeChessCom(deps, { contactEmail: 'x@y.z', fetchFn })

  const past = await cc.monthGames('u', '2020-01')
  expect(past).toHaveLength(2)
  expect(past[0].game?.ok).toBe(true)
  expect(past[0].game?.uciMoves).toEqual(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'])
  expect(past[1].game).toBeNull()
  expect(past[1].rejection?.code).toBe('variant')
  expect(byName(calls, 'PutCommand')).toHaveLength(1)
  expect(byName(calls, 'PutCommand')[0].input.Item.sk).toBe('MONTH#2020-01')

  const current = new Date().toISOString().slice(0, 7)
  await cc.monthGames('u', current)
  expect(byName(calls, 'PutCommand')).toHaveLength(1) // still just the past month
})
