# Domain glossary

The words this codebase uses for its own concepts. A term earns a place here
when a module is named after it. Architecture vocabulary (module, interface,
depth, seam, adapter, leverage, locality) lives in `.claude/skills/codebase-design`.

## Analysis

**Engine record** — what Stockfish said about a move list: start eval, per-ply
eval, best move, PV, book flag, stored classification. Content-addressed by
`hash(moves + engineVersion + nodeBudget)` and deliberately free of anything
game-specific, so two users' identical games share one record.
`packages/shared/src/schemas.ts`.

**Game record** — everything about a game that is not the engine's opinion:
players, clocks, result, date, opening. Joins an engine record at read time.

**Analyzed game** — a game record joined with its engine record, plus which
side the user played. The unit every insight is computed from.
`packages/shared/src/walk.ts`.

**Game walk** — one replay of an analyzed game, carrying everything a single
pass over the move list can produce: the book prefix, per-ply phases, the
terminal status, the opening family, the opponent, the user's own non-book
moves, and per-side accuracy. Computed once per analyzed game and memoized;
insights, archetype, and delighter all read it rather than replaying
themselves. `packages/shared/src/walk.ts`.

**User move** — one of the user's own non-book moves, carrying its
win-probability loss, phase, clock, and outcome context. Book moves are
excluded up front, matching classification.

**Player color / outcome** — which side of a game a named user played, and how
the game ended for that side (`w`/`l`/`d`/`?`). Chess.com usernames are
case-insensitive; the folding rule lives in one place.
`packages/shared/src/player.ts`.

**Classification vs. display tier** — the *stored* classification is four
values (`blunder | mistake | inaccuracy | none`) and feeds insights, accuracy,
and accuracy. The chess.com-style *display tiers* (`brilliant`, `great`,
`best`, `excellent`, `good`, `book`, `inaccuracy`, `mistake`, `miss`,
`blunder`) are re-derived at render time from the record, so re-tuning the
bands re-labels old games with no re-analysis. `packages/shared/src/classify.ts`.

**Wrapped summary** — the finished per-job story: accuracy, archetype,
delighter, worst blunder, poison opening, time pressure, per-game rows.
Produced once, at finalize. `packages/shared/src/wrapped.ts`.

**Archetype** — exactly one label per job, chosen by an ordered rule table over
computed features. Pure and total: the last rule always matches.

**Delighter** — the one rotating weird-stat slot, whichever candidate is most
statistically distinctive for this user. Deterministic, never random.

## Engine

**UCI info** — one parsed `info` line from an engine: depth, multipv, eval, PV,
and whether it is a bound line. Scores arrive relative to the side to move; the
flip to White's perspective happens here and nowhere else. Two adapters sit on
this seam — a child process in the worker, a wasm Worker in the browser.
`packages/shared/src/uci.ts`.

## Job lifecycle

**Job** — one analysis request: an archive slice, a single game, or a PGN
paste. Moves `ingesting -> analyzing -> finalizing -> complete | failed`.

**Ring entry** — one completed game as the live progress UI shows it
(opponent, result, accuracy, plies). Written by the completion transaction.

**Partial aggregate** — running counters on the job item, updated race-free
from the completion path. A preview only; the finalizer recomputes everything.

## Web

**Review session** — the decisions the per-game review page makes: which ply is
selected, whether an exploration branch is active, which eval to show, and what
to draw on the board for the shown position. Pure; the React effect wiring
stays in the page. `packages/web/src/lib/review-session.ts`.

**Branch** — the single active exploration line off the mainline: a base ply
plus the moves played from it. Stepping the mainline discards it.

**Poll** — the loop every job-watching surface shares: repeat until told to
stop, drop a response that lands after cancellation.
`packages/web/src/lib/poll.ts`.
