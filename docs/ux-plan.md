# UX improvement plan

Grounded in the canon the community keeps recommending (the r/userexperience
top-38 list and eleken.co's designer-curated 37: Krug's *Don't Make Me Think* /
*Rocket Surgery Made Easy*, Norman's *Design of Everyday Things*, Cooper's
*About Face*, Saffer's *Microinteractions*, Tidwell's *Designing Interfaces*,
Nielsen's *Usability Engineering*, Frost's *Atomic Design*) plus the two free
working references that condense them: Nielsen Norman's 10 usability heuristics
and lawsofux.com. The Scribd textbook is preview-walled; its unit list (design
thinking, wireframing, research) is covered by the above.

Audited every surface live on 2026-07-10 (desktop 1440 + mobile 390, real
data): landing, /u/[username] games list, per-game report (fresh chess.com-
parity redesign), leaderboard.

## The principles that apply to us (the short list)

- **Krug**: every page self-evident; omit needless words; every click a
  mindless choice.
- **Norman**: visible system status + immediate feedback; signifiers, not
  memory; forgive errors.
- **Fitts**: frequent targets big and close — especially on mobile.
- **Jakob's law**: users arrive with chess.com's mental model; follow it.
- **Postel's law**: be liberal in what the input accepts, strict in output.
- **Doherty threshold / perceived speed**: never leave a dead moment; skeleton
  or progress within 400ms.
- **Peak–end rule**: the last screen of a session decides what users remember.
- **Accessibility baseline**: never color-only signals; visible focus; 44px
  targets (mostly done in phase 4, but new surfaces regressed some of it).

## Audit findings → backlog

### P0 — broken or high-traffic (do first)

1. **Mobile games list is unusable** (`u/[username]/page.tsx`, `.table-scroll`).
   At 390px the date wraps to three lines ("8 / Jul / 26"), Opening wraps to
   four, and Moves + the Analyze button — the whole point of the page — are cut
   off beyond the right edge. *Krug: the primary action must be visible; Fitts.*
   Fix: at <640px collapse the table to stacked row-cards: line 1 = opponent +
   result chip, line 2 = date · opening (truncated) · moves, right side = a
   full-height tap target. Desktop table unchanged.

2. **Result is a color-only lone letter** ("W"/"L" in green/orange). Colorblind
   users get nothing; everyone else gets low signal. *A11y + Norman signifiers.*
   Fix: result chip — `Won`/`Lost`/`Draw` (or `1-0`-style) with color AND text,
   same tokens as the report tiers. Add "as White/Black" (a tiny board-color
   dot): "did I have white?" is the first thing a chess player asks and today
   it's recall, not recognition. Add opponent rating if present in the row data.

3. **Username input violates Postel's law** (landing `page.tsx`). Players paste
   `https://www.chess.com/member/Akshx999`, `@Akshx999`, or a name with a
   trailing space — today those 404 into the in-voice error. Fix: normalize on
   submit (trim, strip leading `@`, extract `/member/<name>` and
   `/stats/live_chess/<name>` URL forms, lowercase). One pure function +
   tests in web (or shared).

4. **Single-game "Analyzing…" is a dead line** (report page pre-record state).
   ~10s of nothing but a static sentence. *Doherty; visibility of status.*
   Fix: reuse the eval-bar shimmer pattern + rotating copy
   ("booting Stockfish… judging your openings… counting the blunders…") and
   the game's players/date header immediately (we already have the games-list
   row data in sessionStorage or can fetch game meta first) so the page feels
   claimed. No backend change: it's presentation over the existing poll.

### P1 — clear wins, small diffs

5. **Landing: one-click proof** — "just show me" link under the CTA that opens
   a known-good sample profile (e.g. `/u/erik`). *Paradox of the Active User:
   nobody types a username to evaluate a product; let them see the games list
   + a finished report with zero effort.* Also add the one-line privacy note
   that already lives on the leaderboard ("public chess.com games only") —
   trust at the point of commitment.

6. **Peak–end: close the review** — when the user steps past the last move,
   the coach card should state the outcome ("Checkmate — Akshx999 wins",
   reuse shared `finalStatus`) and offer "Analyze another game →" (back to
   the list). Today the review just… stops. This is both the emotional peak
   and the retention loop, and it's ~15 lines.

7. **Leaderboard archetype glyph** — rows read "! The Solid One"; the bare `!`
   looks like a rendering bug (it collides with the new great-move `!` mark
   too). Use the archetype's proper emoji/icon or drop the prefix.

8. **Skeleton rows for the games list** — first month fetch shows a blank
   region; render 8 shimmer rows instead. *Doherty.* (The infinite-scroll
   sentinel already handles subsequent months.)

9. **Keyboard discoverability on the report** — one quiet line under the nav
   toolbar: "← → step moves". The arrow keys are the best way to review and
   nothing reveals them. *Recognition over recall; flexibility & efficiency.*

### P2 — nice-to-have, defer until asked

- Filter/search on the games list (opponent, color, result) — *flexibility for
  power users*; wait until someone has >1 month of use.
- Group games-list rows under day headers (*chunking*) instead of repeating
  "8 Jul 26" five times.
- Move numbers on the eval graph x-axis; hover tooltip showing SAN.
- "View" vs "Analyze" label for already-cached games (needs a cheap
  cached-status probe; skip until the API exposes it).
- Red link color (`--accent` on void) contrast re-check against WCAG AA for
  text-size links (the CTA background was already fixed to #d63a33 in the
  security-hardening pass; links were not re-measured).

## Not doing (and why)

- No redesign of the report page — it just reached chess.com parity and the
  reference IS the convention (Jakob's law satisfied).
- No onboarding tour/tooltips — *Krug: if it needs a tour, fix the page.*
- No new dependencies, no component library — Atomic-Design-style reuse of the
  existing tokens/components covers all of the above.

## Execution & verification

Per CLAUDE.md: implement via a sonnet-pinned subagent, Fable reviews; no
commit/push (user's). Verify each P0/P1 item the same way as the report
redesign: vitest + eslint + tsc, then headless-CDP walkthrough at 1440/390
against the dev server on :3000 — specifically: mobile list shows Analyze
without horizontal scroll; result chips have text not just color; pasting a
full chess.com profile URL lands on the games list; analyzing state shows
motion within 400ms; last-move coach card shows the outcome + next action.
