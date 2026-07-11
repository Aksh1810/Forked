// Every user-facing string lives here and nowhere else. Plain verbs,
// sentence case, specific over clever. Errors state the fact and the fix.
// Roast the moves, never the person. No copy mentions the machinery.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DATE_RE = /^(\d{4})[.-](\d{2})[.-](\d{2})/
const MONTH_RE = /^(\d{4})-(\d{2})$/

// `2026-07-10` / `2026.07.10` -> `10 Jul 26`. Falls back to the raw string
// (or '?' when absent) for anything that doesn't match.
export function formatDate(d: string | null): string {
  const m = d ? DATE_RE.exec(d) : null
  if (!m) return d ?? '?'
  const [, yyyy, mm, dd] = m
  const day = Number(dd)
  const month = MONTHS[Number(mm) - 1]
  if (!month || !day) return d ?? '?'
  return `${day} ${month} ${yyyy.slice(2)}`
}

// `2026-07` (the games-list API's month key) -> `July 2026`. Falls back to the
// raw string for anything that doesn't match (B5: sticky month headers).
export function formatMonth(m: string): string {
  const match = MONTH_RE.exec(m)
  if (!match) return m
  const [, yyyy, mm] = match
  const name = FULL_MONTHS[Number(mm) - 1]
  return name ? `${name} ${yyyy}` : m
}

export const copy = {
  sub: "Every game you've played on chess.com, listed instantly. Pick one and Stockfish explains it, move by move, in about ten seconds. Free.",
  inputPlaceholder: 'chess.com username',
  cta: 'Show my games',
  ctaBusy: 'Fetching your games...',
  wrappedToggle: 'Or get the whole-history Wrapped story instead',
  wrappedCta: 'Analyze my games',
  pgnPlaceholder: 'Paste PGN here',
  ticker: (n: string) => `${n} positions judged`,
  leaderboard: 'Leaderboard',
  yourLink: 'This page is your link. Come back anytime.',
  browseHint: 'Enter your chess.com username first.',
  demoLink: 'just show me one →',
  privacyLine: 'Public chess.com games only. Nothing to sign up for.',

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
    // Quiet ETA line (C2/item 3) while a job is analyzing.
    etaMinutes: (n: number) => `about ${n} min left`,
    etaUnderMinute: 'under a minute left',
  },

  // The browse list: pull all your games, analyze one at a time.
  browse: {
    title: (u: string) => `@${u}'s games`,
    back: 'Back',
    analyzeAll: 'Analyze all',
    analyze: 'Analyze',
    analyzing: 'Analyzing...',
    empty: 'No games in this month.',
    none: 'No games found for this account.',
    loading: 'Pulling your games...',
    loadOlder: 'Load older games',
    end: "That's every game.",
    endCount: (n: number) => `${n} ${n === 1 ? 'game' : 'games'} · that's all of them`,
    // Won/Lost filter chips (B4): "All" alongside the existing won/lost
    // strings; the count line while a filter is active names both numbers
    // honestly instead of pretending the filtered list is the whole list.
    filterAll: 'All',
    filteredCount: (shown: number, loaded: number) => `${shown} of ${loaded} loaded`,
    analyzingGame: 'Analyzing this game. Stockfish is looking...',
    noAnalysis: 'This game has no analysis.',
    colDate: 'Date',
    colOpponent: 'Opponent',
    colOpening: 'Opening',
    colLength: 'Moves',
    won: 'Won',
    lost: 'Lost',
    draw: 'Draw',
    playedWhite: 'you played white',
    playedBlack: 'you played black',
    // Rotating status pool for a single-game wait, one line every ~2.5s.
    analyzingSteps: [
      'Booting Stockfish...',
      'Judging your openings...',
      'Counting the blunders...',
      'Double-checking the ending...',
    ],
  },

  // The per-game review: coach card sentences and move navigation.
  coach: {
    hint: 'Select a move or press ▶',
    // "<san> is <...>" headline fragments, one per classification tier.
    is: {
      brilliant: 'is brilliant',
      great: 'is a great move',
      best: 'is the best move',
      excellent: 'is excellent',
      good: 'is a good move',
      book: 'is a book move',
      inaccuracy: 'is an inaccuracy',
      mistake: 'is a mistake',
      miss: 'is a miss',
      blunder: 'is a blunder',
      none: 'is a normal move',
    },
    bestWas: (san: string) => `Best was ${san}.`,
    bestButton: 'Best',
    resume: 'Resume',
    // Retry mistakes (A2, lite practice mode): the "Try a better move" chip
    // and the three coach-area states while it's active.
    tryAgain: 'Try a better move',
    retryPrompt: 'Your move — find the best one.',
    retrySuccess: "That's the best move.",
    retryWrong: 'Not quite — try again or see the best move.',
    showBest: 'Show best',
    next: 'Next ▶',
    prevLabel: 'Previous move',
    nextLabel: 'Next move',
    firstLabel: 'First move',
    lastLabel: 'Last move',
    navFirst: '|◀',
    navPrev: '◀',
    navNext: '▶',
    navLast: '▶|',
    accuracy: 'Accuracy',
    // The turning-point headline on the pre-review summary card.
    turnedOn: (move: string, san: string) => `The game turned on move ${move} — ${san}.`,
    // End-of-review closure line, plus the link onward.
    outcomeCheckmate: (winner: string) => `Checkmate — ${winner} wins.`,
    outcomeStalemate: 'Stalemate — a draw.',
    outcomeResult: (winner: string, result: string) => `${winner} wins ${result}.`,
    outcomeDraw: 'A draw.',
    analyzeAnother: 'Analyze another game →',
    // Best-preview / explore-mode headline.
    exploring: 'Exploring the best line',
    // Key-moves filter toggle above the move list.
    filterAll: 'All moves',
    filterKey: 'Key moves',
    keysHint: '← → step through moves',
    // Phase-accuracy row labels on the summary card.
    phaseOpening: 'Opening',
    phaseMiddlegame: 'Middlegame',
    phaseEndgame: 'Endgame',
    // Coach motif sentences (shared/classify.ts moveMotif kinds).
    allowsMate: (n: number) => `This allows mate in ${n}.`,
    missedMate: (n: number) => `You had a forced mate in ${n}.`,
    hangs: (piece: string) => `This hangs the ${piece}.`,
    bestWasTake: (piece: string, square: string) => `Best was to take the ${piece} on ${square}.`,
  },

  // Leaderboard: public by construction, removable by anyone who asks.
  leader: {
    title: 'Leaderboard',
    tabAccuracy: 'Accuracy',
    tabBlunder: 'Blunder of the day',
    floorNote: 'Ranked after 50 analyzed games.',
    archetypeNote: 'Archetype is a playstyle read from your move history, not a rating.',
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

// Book-tier coach headline, naming the opening: "<san> is a book move · <name>".
export const bookHeadline = (san: string, openingName: string) => `${san} ${copy.coach.is.book} · ${openingName}`

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
