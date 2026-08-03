# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Rules & Model Routing

### Model Architecture Boundaries
- **Opus (Main Loop):** Use `-opus-4.8` on default effort for high-level architecture, complex refactoring plans, edge-case analysis, and code reviews.
- **Sonnet (Subagents):** Delegate implementation, file searches, testing scripts, and boilerplate generation to `claude-sonnet-5`.

### Development Workflow
1. **Plan Phase:** Opus reads files, mapping out changes. It must write a formal spec under `docs/migration-plan.md`.
2. **Execution Phase:** Opus must spawn a subagent explicitly pinned to `sonnet` to implement the code changes.
3. **Review Phase:** Opus reads Sonnet's code diffs, verifies against test tool outputs, and approves.

### Standing rule
The user commits and pushes themselves. Do not `git commit` or `git push` unless explicitly ordered in that session.

## Commands

```bash
npm ci                      # install (Node 20+, see .nvmrc)
npm test                    # vitest across all four packages
npm run lint                # eslint
npm run typecheck           # tsc -b, then tests tsconfig, then web
npm run synth               # cdk synth of the control stack (Docker-free)
npx tsc -b                  # build to dist/ — REQUIRED before running worker/control locally
```

Single test file or name filter:

```bash
npx vitest run packages/shared/test/classify.test.ts
npx vitest run -t "blunder"
```

Local stack (no Docker needed; `docker compose up` does the same containerized):

```bash
node scripts/local/dev.mjs            # everything below in one process tree, Ctrl-C stops all
node scripts/local/jvm-stack.mjs up   # dynamodb-local :8000 + elasticmq :9324
npm run api -w packages/control       # control API :8787
node packages/worker/dist/main.js     # one worker; run N for N-way parallelism
npm run dev -w packages/web           # web :3000
```

`dev.mjs` needs `npx tsc -b` already run, `java` on `PATH`, and Stockfish; it waits on ports with fixed sleeps, no health checks.

Workers need a Stockfish binary on `PATH` or `STOCKFISH_PATH`. It must match `PINNED_ENGINE_VERSION` in `packages/shared/src/config.ts` or cache keys diverge from Dockerfile builds; the worker fails loudly on mismatch. To point the web app at a deployed API instead of localhost, set `NEXT_PUBLIC_API_BASE`. Full env var table: `docs/self-hosting.md`.

`scripts/local/` holds repeatable kill tests and phase gates (`gate-phase3/4/5.mjs`, `benchmark.mjs`), not manual checklists. They require the local stack up and, for some, workers stopped. `scripts/kill-tests/run-all.mjs` runs the a–f failure-injection suite (worker killed, duplicate delivery, heartbeat, poison/DLQ, SIGTERM requeue, cache rerun).

CI (`.github/workflows/ci.yml`) runs lint + typecheck + test on Ubuntu with the distro Stockfish, and separately builds both worker images (`Dockerfile`, `Dockerfile.lambda`) to prove the pinned engine download and that `lambda.js` exports `handler`/`dlqHandler`. Docker is not needed locally; CI is where image builds are proven.

## Architecture

npm-workspaces monorepo. `packages/shared` is pure domain logic and by far the most heavily tested; `packages/worker` is the UCI wrapper plus both worker entrypoints (`main.ts` poller, `lambda.ts` handler factory); `packages/control` is the HTTP API, ingest, janitor, and CDK stack; `packages/web` is Next.js. See the README's mermaid diagram for the request flow. `CONTEXT.md` is the domain glossary — a term is listed there when a module is named after it; read it before naming anything new.

**One barrel per package.** `packages/shared/src/index.ts` is the entire cross-package surface; nothing outside `shared` deep-imports `@forked/shared/...`. A new shared concept means a new module plus one export line there.

**Exactly-once accounting on an at-least-once queue.** `packages/worker/src/completion.ts` holds THE completion transaction — one `TransactWriteItems` that conditionally flips the game item out of `pending`, bumps the job counter, and updates the ring buffer and partial aggregates. A duplicate SQS delivery fails the condition and the whole transaction no-ops. There is no other code path anywhere that increments job counters; do not add one. Finalization works the same way (`finalize.ts`: conditional `analyzing -> finalizing` claim, then `finalizeJob`).

**The janitor does not trust the counters.** `control/src/janitor.ts` sweeps overdue jobs via a sparse GSI (only `analyzing` jobs carry `gsi1pk`/`gsi1sk` — see `analyzingGsiAttrs` in `shared/src/table.ts`), recounts from the game items, repairs drift, requeues stuck games (safe because completion is idempotent), re-drives crashed finalizers, and releases orphaned locks. Any new failure mode should converge on the next sweep rather than need a bespoke repair path.

**Single-table DynamoDB.** Every key shape lives in `shared/src/table.ts` and nowhere else — job, game, cache, lock, metrics, archive, and rate-limit items all share one table.

**Content-addressed determinism.** An `EngineRecord` is keyed by `hash(moves + engineVersion + nodeBudget)` (`cache-key.ts`) and must contain NOTHING game-specific — no clocks, names, timestamps, or game ids. That separation is enforced structurally by `EngineRecordSchema` (zod `strictObject`) plus a test, and it is what makes cache sharing between users safe. Game-specific data lives in `GameRecord`; the two join at read time. The engine always runs `Threads=1`, fixed hash, fixed node budget — never depth or time limits — so identical input yields byte-identical output on any hardware.

**Two fleets, one budget.** `control/src/route.ts` picks a queue per game: the Lambda container fleet only when `LAMBDA_QUEUE_NAME` is set, the monthly GB-seconds counter is under budget, and the game is short enough; everything else goes to plain container workers. The Lambda handler meters its own GB-seconds back into that counter.

**Stored classification vs. displayed tier.** The persisted `classification` enum is only four values (`blunder | mistake | inaccuracy | none`) and feeds accuracy. The chess.com-style display tiers (`brilliant`/`great`/`best`/`excellent`/`good`/`book`/`inaccuracy`/`mistake`/`miss`/`blunder`) are derived at render time by `enrichClassifications()` in `shared/src/classify.ts`, which recomputes the swing bands from the record rather than trusting the stored enum. That means re-tuning the bands re-labels already-analyzed games with no re-analysis — but it also means `golden.test.ts` must be deliberately re-pinned whenever the band constants change. The band constants (`BLUNDER_LOSS`, `MISTAKE_LOSS`, `INACCURACY_LOSS`, `GOOD_MAX`, `EXCELLENT_MAX`) are calibrated against real chess.com Game Review output per-ply, not chosen analytically.

**Derived-at-read features.** `shared/src/moment.ts` (`momentFor`) picks the viewer's single worst move — biggest win% drop among the plies *they* played, ≥20 points or `null` — plus the refutation, the FENs around it, and a cliff sparkline window. Like the display tiers, it is computed from a stored `EngineRecord` at read time, so it costs no re-analysis and re-tunes freely. `shared/src/win.ts` owns win% conversion; do not open-code cp→win% anywhere else.

**Web surfaces.** `/` landing, `/u/[username]` games list, `/j/[jobId]/g/[gameId]` review board, `/j/[jobId]/g/[gameId]/moment` cinematic replay, `/about`; `/j/[jobId]` is a redirect shim kept for links shared before a job meant exactly one game. Root-level `opengraph-image`/`twitter-image` render one branded share image via `@vercel/og`. Control API: `POST /ingest`, `GET /games/:username`, `GET /job/:id`, `GET /job/:id/game/:gameId`, `GET /metrics`, `GET /health`.

**Web.** All user-facing strings live in `packages/web/src/copy.ts` and nowhere else. The browser-side Stockfish (`lib/engine.ts`, a wasm worker) is copied into `public/engine/` by the `predev`/`prebuild` script and is gitignored. `lib/engine.ts` deliberately pauses searching while `document.hidden` — a backgrounded tab showing "Loading engine…" is expected, not a bug. Page-level decision logic is pulled out pure and tested (`lib/review-session.ts`, `lib/poll.ts`, `lib/moves.ts`); the React effect wiring stays in the page.

**Motion has one gate.** Every animated component — `components/bits/*` (LetterGlitch, GooeyNav, SplitText, …) and effects like `CheckmateFx` — imports `usePrefersReducedMotion`/`prefersReducedMotion` from `components/bits/reducedMotion.ts` and renders the static form, or nothing, under reduce. Decorative motion returns `null`; informational content never does. New animated components follow the same contract. Canvas/RAF loops also pause while the tab is hidden.

## Gotchas

- The npm `stockfish` package shims `node_modules/.bin/stockfish`, shadowing the native binary under npm/vitest `PATH`. Tests strip `.bin` entries; Dockerfiles pin `STOCKFISH_PATH`.
- `.dockerignore` patterns need `**/` prefixes — a bare `cdk.out` does not match `packages/control/cdk.out` and synth recurses.
- Vitest excludes `cdk.out`, which stages full repo copies including test files; without that the test count inflates.
- chessops castling must be converted to standard UCI (`standardUci` in `shared/src/pgn.ts`, mirrored in `scripts/build-openings.mjs`).
- `shared/src/openings.gen.ts` is generated (400KB, from the lichess opening TSVs by `scripts/build-openings.mjs`). Never hand-edit it; regenerate.
- `docs/migration-plan.md` is gitignored (private ops log); the rest of `docs/` is published and linked from the README. `docs/ui-audit-2026-07.md` and `docs/ux-plan.md` are the standing frontend backlog.
- `.claude/skills/*` are symlinks into `.agents/skills/`; edit the real files under `.agents/`.
- Stockfish is GPLv3 and runs strictly as a separate process — never link or vendor it. The cburnett piece set in `web/src/components/pieces.tsx` is vendored from lichess with its licence noted in the README.
