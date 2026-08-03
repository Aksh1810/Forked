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

// Phase display labels, used by the report summary.
export const phaseLabels: Record<'opening' | 'middlegame' | 'endgame', string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
}

export const copy = {
  sub: "Every game you've played on chess.com, listed instantly. Pick one and Stockfish explains it, move by move, in about ten seconds. Free.",
  inputPlaceholder: 'chess.com username',
  cta: 'Show my games',
  tickerSuffix: 'positions judged',
  browseHint: 'Enter your chess.com username first.',
  // Shown by the /j/[jobId] shim when an old shared link resolves to nothing.
  jobGone: 'No analysis lives at this link.',
  privacyLine: 'Public chess.com games only. Nothing to sign up for.',

  errors: {
    'user-not-found': "That username doesn't exist on chess.com.",
    'no-games': "That game isn't in this account and month.",
    'rate-limited': "You've hit today's limit for this account. Come back tomorrow.",
    busy: 'This account is being analyzed right now. Try again in a moment.',
    'bad-request': "That doesn't look like a chess.com username.",
    upstream: "chess.com isn't answering right now. Try again in a minute.",
    generic: 'Something broke on our side. Try again.',
  } as Record<string, string>,

  outage: {
    // K6: the per-game poll gives up after repeated network failures,
    // distinct from the "no analysis exists" / notFound copy.
    gamePoll: "Couldn't reach the server — refresh to retry.",
  },

  // The browse list: pull all your games, analyze one at a time.
  browse: {
    title: (u: string) => `@${u}'s games`,
    back: 'Back',
    analyze: 'Analyze',
    // Shown in place of `analyze` once a game has already been analyzed
    // (browse list, item 6) — click behavior is unchanged, only the label.
    review: 'Review',
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
    prevLabel: 'Previous move',
    nextLabel: 'Next move',
    firstLabel: 'First move',
    lastLabel: 'Last move',
    navFirst: '|◀',
    navPrev: '◀',
    navNext: '▶',
    navLast: '▶|',
    // E1: the qualified line under each player's big accuracy % headline.
    estEloLine: (elo: number) => `est. ~${elo} Elo`,
    // End-of-review closure line, plus the link onward.
    outcomeCheckmate: (winner: string) => `Checkmate — ${winner} wins.`,
    outcomeStalemate: 'Stalemate — a draw.',
    outcomeResult: (winner: string, result: string) => `${winner} wins ${result}.`,
    outcomeDraw: 'A draw.',
    // Terminal-checkmate flourish (CheckmateFx overlay).
    endWin: 'You won',
    endLoss: 'Checkmated',
    analyzeAnother: 'Analyze another game →',
    // "The moment you lost": the cinematic replay of the game's turning point.
    // Roasts target the move and the situation, never the player.
    moment: {
      openLost: 'The moment you lost →',
      openSlipped: 'The moment it slipped →',
      title: 'The moment you lost',
      titleSlipped: 'The moment it slipped',
      vs: (op: string) => `vs ${op}`,
      calm: (moveNum: number) => `Move ${moveNum}. You're in this.`,
      crash: (pct: number) => `−${pct}% in one move.`,
      bestWas: (san: string) => `Best was ${san}.`,
      stamp: 'BLUNDER',
      roasts: [
        'Stockfish is still processing what just happened.',
        'That move had a family. It has one no longer.',
        'You had a plan. The plan filed for divorce.',
        'Somewhere, a chess coach felt a chill.',
        'This is why the eval bar drinks.',
        'A quiet move. A loud consequence.',
      ],
      replay: 'Replay',
      copyLink: 'Copy link',
      copied: 'Link copied',
      backToGame: 'See the full game →',
      noMoment: 'No single collapse — this one slipped away slowly.',
    },
    // Live explore/branch mode (playable board + browser Stockfish):
    // ExploreCard/BranchCard lines.
    exploreYourMove: 'Exploring — your move',
    exploreMoves: (sans: string) => `Exploring — ${sans}`,
    // Live engine lines panel (chess.com-style MultiPV list) — the sole owner
    // of engine-status copy; BranchCard no longer duplicates it.
    // Per-line explore affordance in the engine panel — clicking a line plays
    // its first move onto the board and opens explore mode.
    engineExplore: (san: string) => `Explore ${san}`,
    engineExploreCue: 'explore →',
    engineLinesLoading: 'Loading engine…',
    engineLinesUnavailable: 'Engine unavailable — stored analysis still shown.',
    // FIX 3: shown instead of the (would-be endless) loading line once the
    // shown position is checkmate/stalemate.
    engineLinesTerminal: 'No moves — the game is over.',
    engineDepth: (d: number) => `depth ${d}`,
    // Key-moves filter toggle above the move list.
    // E3: the arrows render as <kbd> elements now — this is just the tail text.
    keysHint: 'step through moves',
    // Phase-accuracy row labels on the summary card.
    // Coach motif sentences (shared/classify.ts moveMotif kinds).
    allowsMate: (n: number) => `This allows mate in ${n}.`,
    missedMate: (n: number) => `You had a forced mate in ${n}.`,
    hangs: (piece: string) => `This hangs the ${piece}.`,
    bestWasTake: (piece: string, square: string) => `Best was to take the ${piece} on ${square}.`,
  },

  // /about page: one quiet GPL-credit line for the live browser Stockfish
  // engine (item 10, Wave 2).
  about: {
    engineCredit: 'Analysis engines: Stockfish (GPLv3) —',
    engineSource: 'source',
    engineLicense: 'license',
  },
} as const

// Book-tier coach headline, naming the opening: "<san> is a book move · <name>".
export const bookHeadline = (san: string, openingName: string) => `${san} ${copy.coach.is.book} · ${openingName}`
