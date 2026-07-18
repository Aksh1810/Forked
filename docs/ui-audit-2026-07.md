# Full UI/UX Audit — 2026-07-16

Method: 4 inspiration-research agents (component libraries, layout galleries,
palettes, product patterns — grounded in chess.com Game Review v2, lichess,
Linear, Vercel Geist, Spotify Wrapped, Mobbin glossaries) + 6 parallel
auditors (hierarchy, color/type, motion, accessibility, mobile, performance)
over every surface. Findings verified against code; contrast ratios computed
numerically.

## Executive summary

The app's bones are good — contrast discipline passes everywhere it matters,
reduced-motion coverage is complete across all 16 bits, the 390px mobile path
is well-built, and tests/typecheck are green. The systemic problems are:

1. **One visual level.** Every panel, chip, card, and button is the same
   hairline-outlined box on the same surface. Nothing leads. No elevation
   ladder, no KPI tier, no stat anatomy.
2. **Red means nothing.** Red is simultaneously the brand accent, every link,
   every chart bar, cursor glow, particle color, AND the blunder signal. The
   product's core semantic ("red = you blundered") is diluted everywhere.
3. **Inverted stat hierarchy on the report.** The least trustworthy number
   (heuristic est. Elo) is the headline; the real accuracy % isn't shown.
4. **Entrances hide content.** FadeContent/SplitText mount at opacity 0 —
   frozen blank in background tabs, blank on slow first paint.
5. **Motion is scattered.** 8 durations, 3+ easings, several pages stack 3+
   competing effects; no page has a designated hero moment.
6. **The 721–1000px band is broken** (tiny board beside fixed 400px panel),
   and pointer-driven bits misbehave on touch (board swallows scroll, Magnet
   drags the CTA mid-tap, DotGrid burns battery for a glow touch can't fire).

## Redesign decision

**Palette: C-hybrid ("Rose Charcoal" neutrals + coral blunder).**
Warm charcoal neutrals preserve the bone identity while lifting every weak
pair; coral `#f2555a` replaces rose to stay continuous with the current brand
red. Classification (`--cls-*`) and board tokens ship unchanged.

| Token | Current | New |
|---|---|---|
| --void | #0b0c10 | #111013 |
| --surface | #14161c | #1a181c |
| --line | #262a33 | #2c2933 |
| --bone | #e8e4d9 | #ece7e1 |
| --muted | #8a8d94 | #9a939d (6.35:1) |
| --blunder | #e5443d | #f2555a |
| --accent-text | #e85d55 | #fb7185 (7.05:1) |
| --mistake | #e58f3c | #fb923c |
| --inaccuracy | #e5c13d | #e8c547 |
| --best | #59a96a | #5fb877 |

New structural tokens: `--surface-2` (elevated step, color-mix bone 4% over
surface), `--cta` (contrast-darkened blunder), `--cls-best`, `--cls-book`,
`--eval-dark/--eval-light`, type scale `--fs-micro/caption/small/body/lead/
title/stat/display`, motion `--dur-fast 120ms / --dur-base 240ms / --dur-slow
400ms`, easings `--ease-out (0.2,0.8,0.2,1)` and `--ease-pop (0.2,0.9,0.3,1.2)`.

Prerequisite: chase the ~12 hardcoded hexes that escape the token block
(classification.tsx TIER map, 4 bits JS defaults, .cta, 2 gradient hexes,
color-dots, eval-bar greys; OG-route constants stay but get a lockstep
comment).

## Ranked backlog

### P0
1. Report SummaryCard: paired **accuracy %** becomes the headline stat;
   est. Elo demoted to small qualified line. (hierarchy #1, product #2)
2. FadeContent/SplitText entrances: baseline opacity 0.6 (never 0), duration
   300ms/240ms; keep IO gating. (motion #1-2, mobile #11)
3. Breakdown: gate every chart on n≥3 data points; below, render big-numeral
   stat tile / "Analyze 5+ games to unlock this trend" in the same panel
   shape. (hierarchy #2, layout #6)
4. `.review` grid: collapse to single column below ~1000px — 721-1000px
   currently yields a ~250px board beside a fixed 400px panel. (mobile #1)
5. Red reservation, part 1: links → bone+underline (accent-text reserved for
   errors); breakdown bars → bone with red only on the worst bar.
   (color #2.1-2.2)

### P1
6. Palette swap to C-hybrid + tokenization sweep (see Redesign decision).
7. Elevation ladder: `.panel`/`.coach-card` become tone-stepped surfaces
   (surface → surface-2), hairlines only where a tone step can't work (table
   rows). (hierarchy #7)
8. Breakdown KPI strip: 4 tiles (accuracy, blunder rate, games, worst phase)
   above the chart grid; label→numeral→context anatomy. (hierarchy #3)
9. Report panel: one-line verdict + primary CTA "Step through your N
   blunders →" (selects first flagged ply); kbd chips for the ←→ hint.
   (hierarchy #5, #18)
10. Landing: demote the two StarBorder chips to quiet links; scope ClickSpark
    to the hero or drop; ShinyText on hover only. One accent object (CTA).
    (hierarchy #4, motion #4-5)
11. Progress completion beat: hold filled bar ~800ms, then the existing blur
    handoff into Story as the app's one long transition. (motion #3)
12. Leaderboard: podium ghost card for empty slots (invite CTA), fixed
    3-col grid; drop DotGrid here (or bone glow). (hierarchy #6, motion P2)
13. Touch fixes: Magnet gates on `(hover:hover) and (pointer:fine)`; Board
    `touchAction: pan-y` (drag still sets none on pointerdown); DotGrid draws
    one static frame on non-hover devices + DPR scaling. (mobile #2-4)
14. GooeyNav pressed state CSS (aria-pressed currently invisible);
    filter click loses the redundant FadeContent remount. (a11y #1, motion #6)
15. A11y pass: TierIcon dark glyph + aria-label; move-cell aria-label with
    tier word; progress page sr-only live region; TextType sr-only full text;
    Story Space-key guard; story dots muted color. (a11y #2-7)
16. Motion system: 3 durations, 2 easings, one hero per page; cut list per
    motion audit (about/leaderboard FadeContents, share-CTA StarBorder,
    stagger retimed 20ms×8). (motion system)

### P2
17. Charts: axis/bar labels legible at mobile scale (render outside scaled
    viewBox or ≥16 viewBox units); gridlines per elevation ladder; desaturate
    series. (mobile #5, layout #8)
18. Coach-card fixed 112px slot → min-height at ≤720px; summary card gets
    height parity to stop the first-step bounce. (mobile #6, hierarchy #13)
19. Engine lines behind a collapsed `<details>` at ≤720px. (mobile #7)
20. `.page-title` class replacing 4 ad-hoc h1 sizes; report header adopts
    .dash-head rhythm; podium/table width alignment; pps demoted to quiet
    line; remove-me section restyled; breakdown skeleton mirrors real grid;
    landing leaderboard link folds into footer. (hierarchy P2s)
21. Type scale migration (8 steps absorb 19 ad-hoc sizes, Story/Card px →
    rem). (color #4)
22. nav-toolbar safe-area inset; month-divider content-visibility scoping;
    eval-graph dot hit targets; tab-row/button-row flex-wrap; engine-line
    44px tap height; focus restore after report mode swaps; month divider
    aria-hidden removal. (mobile #8-10, #12; a11y #11-13)
23. Story: segmented progress bars replace mono dots (44px targets kept);
    Card stat anatomy (label→value→context). (product #16, hierarchy #14)

### P3
24. Rolling eval-label digits on /g; PGN-submit micro-loader; TextType
    cadence 8s; single shimmer duration token; leaderboard sticky first
    column / edge fade; lost-pill color unification; Story aria-current
    cleanup; arrow-key input guard on /g.

### Performance auditor (completed after first draft)
P0: progress page flips permanently to "no analysis" on one network blip
(missing=true with no streak/reset). P1: DotGrid repaints ~2,200 dots/frame
forever even with pointer offscreen (idle-stop needed); ElectricBorder's SMIL
turbulence animation is the most expensive loop in the app (make static);
StarBorder animates layout properties (left/right) — moot once removed;
.status-line reserves 1 line but wraps to 2 (recurring CLS every 4s).
P2: report/breakdown/leaderboard conflate network failure with not-found/empty;
null time-pressure buckets render as 0.0% bars; Ticker polls hidden tabs.
P3: status rotation runs past terminal; pps slot mounts/unmounts (jump);
story Count not tabular; eval-bar shine loops after terminal.
Engine-page rule verified intact: zero competing loops on /g. Noise and
LetterGlitch verified cheap. Reduced-motion coverage: no gaps found.
All folded into Spec v3 section K.

## Per-audit source reports

Full one-liner findings live in the six auditor outputs (session transcripts);
this doc is the merged, deduplicated ranking. Inspiration digest (palettes,
patterns, idioms, sources incl. chess.com GR v2, Linear, Wrapped):
scratchpad/inspiration-digest.md from the session.
