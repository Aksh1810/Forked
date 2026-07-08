// Every user-facing string lives here and nowhere else. Plain verbs,
// sentence case, specific over clever. Errors state the fact and the fix.
// Roast the moves, never the person. No copy mentions the machinery.

export const copy = {
  sub: 'Full-engine analysis of your entire chess.com history. Free.',
  inputPlaceholder: 'chess.com username',
  cta: 'Analyze my games',
  ctaBusy: 'Fetching your games...',
  expandToggle: 'Paste PGN or pick a date range',
  pgnPlaceholder: 'Paste PGN here',
  ticker: (n: string) => `${n} positions judged`,
  leaderboard: 'Leaderboard',
  yourLink: 'This page is your link. Come back anytime.',
  browseToggle: 'Or browse your games and analyze just one',
  browseHint: 'Enter your chess.com username first.',

  errors: {
    'user-not-found': "That username doesn't exist on chess.com.",
    'no-games': 'This account has no games yet.',
    'archive-too-large': "That's a lot of games. Pick a date range below and try again.",
    'rate-limited': "You've hit today's limit for this account. Come back tomorrow.",
    busy: 'This account is being analyzed right now. Try again in a moment.',
    'bad-request': "That doesn't look like a chess.com username.",
    upstream: "chess.com isn't answering right now. Try again in a minute.",
    generic: 'Something broke on our side. Try again.',
  } as Record<string, string>,

  progress: {
    gamesLabel: 'games judged',
    ppsLabel: 'positions per second',
    completeTitle: 'Analysis complete.',
    completeNote: 'Your story is on its way. This link will hold it.',
    failedTitle: 'This one broke on our side.',
    failedNote: 'Try again from the start. Your games are safe on chess.com.',
    notFound: 'No analysis lives at this link.',
    skippedGames: (n: number) => `${n} ${n === 1 ? 'game' : 'games'} skipped:`,
  },

  // The browse list: pull all your games, analyze one at a time.
  browse: {
    title: (u: string) => `@${u}'s games`,
    back: 'Back',
    analyzeAll: 'Analyze all',
    analyze: 'Analyze',
    analyzing: 'Analyzing...',
    older: 'Older',
    newer: 'Newer',
    empty: 'No games in this month.',
    none: 'No games found for this account.',
    loading: 'Pulling your games...',
    analyzingGame: 'Analyzing this game. Stockfish is looking...',
    noAnalysis: 'This game has no analysis.',
    colDate: 'Date',
    colOpponent: 'Opponent',
    colOpening: 'Opening',
    colLength: 'Moves',
  },

  // Leaderboard: public by construction, removable by anyone who asks.
  leader: {
    title: 'Leaderboard',
    tabAccuracy: 'Accuracy',
    tabBlunder: 'Blunder of the day',
    floorNote: 'Ranked after 50 analyzed games.',
    empty: 'The board opens once someone finishes a 50-game analysis.',
    emptyBlunder: 'No blunder has claimed the day yet.',
    colRank: '#',
    colPlayer: 'Player',
    colAccuracy: 'Accuracy',
    colGames: 'Games',
    colArchetype: 'Archetype',
    blunderBy: (u: string) => `@${u}`,
    blunderLine: (move: string, loss: number, opponent: string) =>
      `${move} against ${opponent} threw away ${loss.toFixed(1)} points of win probability.`,
    removeTitle: 'Not into this?',
    removeNote: 'The board is built from public chess.com games. Remove yourself anytime.',
    removePlaceholder: 'chess.com username',
    removeCta: 'Remove me',
    removeBusy: 'Removing...',
    removeDone: 'Removed. Your entry will not appear again.',
    back: 'Back',
  },

  // Rotating status pool, one line every 4 seconds.
  statusLines: [
    'Judging your endgames...',
    'Counting the queens you hung...',
    'Asking Stockfish if that was really the plan...',
    'Measuring the depth of that h-pawn push...',
    'Finding the knight you left on the rim...',
    'Replaying the trades you instantly regretted...',
    'Checking whether that sacrifice was on purpose...',
    'Locating your rooks. Still on their starting squares...',
    'Grading your opening theory. Generously...',
    'Watching your clock melt in the endgame...',
    'Tallying the forks you walked into...',
    'Reading your resignations for dramatic timing...',
    'Confirming the bishop pair was, at some point, a pair...',
    'Weighing every pawn you called poisoned and ate anyway...',
    'Sorting your wins from your escapes...',
  ],
} as const

// Story copy. Roast the moves, never the person; every playful line pairs with
// the stat that earned it; the arc closes on a flex. All templates live here,
// never inline in components.
export const story = {
  scale: (positions: string, games: number) => `We judged ${positions} positions across ${games} games.`,
  scaleSub: 'That took a pool of chess engines a while. It took you a lifetime.',
  accuracyTitle: 'Your accuracy',
  accuracyPercentile: (p: number) => `Better than ${p}% of analyzed players.`,
  accuracyNoPercentile: 'A percentile lands here once enough players are ranked.',
  flexTitle: 'Your best moment',
  flexLine: (move: string, opponent: string) => `${move} against ${opponent}. Stockfish agrees with you.`,
  flexGameLine: (acc: number, opponent: string) => `Your cleanest game: ${acc.toFixed(1)}% against ${opponent}.`,
  blunderTitle: 'Your worst move',
  blunderLine: (move: string, loss: number) =>
    `${move} threw away ${loss} points of win probability in a single move.`,
  poisonTitle: 'Your poison opening',
  poisonLine: (family: string, mult: number) => `You blunder ${mult}x more often in the ${family} than your average.`,
  timeTitle: 'Under pressure',
  timeLine: (drop: number) => `Under 30 seconds on the clock, your accuracy drops ${drop.toFixed(1)} points.`,
  timeNoDrop: 'The clock does not rattle you. Rare.',
  worstDayLine: (date: string, games: number) => `Your worst day was ${date}. ${games} games. It went how you think.`,
  archetypeKicker: 'Your archetype',
  delighterTitle: 'One more thing',
  toCard: 'See your card',
  skipToCard: 'Skip to card',
  replay: 'Replay',
} as const

// Delighter templates, one per weird-stat kind, keyed to match the shared
// Delighter discriminated union.
export const delighterLines = {
  'longest-game': (plies: number, opp: string) =>
    `Your longest game ran ${Math.ceil(plies / 2)} moves against ${opp}. Nobody was having fun.`,
  'most-faced': (opp: string, count: number) => `You faced ${opp} ${count} times. A rivalry, whether they know it or not.`,
  'blundered-square': (square: string, count: number) => `You hung ${count} pieces on ${square}. That square is cursed.`,
  'favorite-piece': (piece: string, count: number) => `You moved your ${piece} ${count} times. It is doing the heavy lifting.`,
  comebacks: (count: number) => `You won ${count} games you were dead lost in. Refusing to resign is a strategy.`,
} as const

// Card and share copy.
export const share = {
  xText: (archetype: string, url: string) => `apparently I'm ${archetype} ?? ${url}`,
  nativeTitle: 'My forked card',
  download: 'Download PNG',
  downloadStory: 'Download story size',
  copyLink: 'Copy link',
  copied: 'Copied',
  shareX: 'Share to X',
  shareNative: 'Share',
  breakdown: 'See the full breakdown',
} as const

// The anticipation-teaser slot. Once partial aggregates exist (~30 percent
// completion) a status line is occasionally replaced by a teaser built from
// real forming data. Teasers hint, never reveal; the reveal belongs to the
// story. Returns null when there is not yet enough signal to say something true.
export function pickTeaser(agg: {
  opb: Record<string, number>
  opm: Record<string, number>
  phb: Record<string, number>
  phm: Record<string, number>
} | null, completed: number, total: number): string | null {
  if (!agg || total === 0 || completed / total < 0.3) return null

  // A family the user is visibly blundering in, with a real sample.
  let worstFamily: { family: string; rate: number } | null = null
  for (const [family, moves] of Object.entries(agg.opm)) {
    if (moves < 8) continue
    const rate = (agg.opb[family] ?? 0) / moves
    if (!worstFamily || rate > worstFamily.rate) worstFamily = { family, rate }
  }
  if (worstFamily && worstFamily.rate > 0) return `We found something in your ${worstFamily.family} games...`

  // Otherwise a phase where the trouble concentrates.
  let worstPhase: { phase: string; blunders: number } | null = null
  for (const [phase, blunders] of Object.entries(agg.phb)) {
    if (!worstPhase || blunders > worstPhase.blunders) worstPhase = { phase, blunders }
  }
  if (worstPhase && worstPhase.blunders > 0) {
    const where = worstPhase.phase === 'opening' ? 'the opening' : worstPhase.phase === 'endgame' ? 'the endgame' : 'the middlegame'
    return `${where[0].toUpperCase()}${where.slice(1)} is where things happen for you...`
  }
  return null
}
