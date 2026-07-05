# Forked

Distributed chess analysis. Enter a chess.com username, a pool of Stockfish
workers analyzes your entire archive at full, consistent engine depth, and you
get a Wrapped-style story, a shareable card, and archive-level insights no
per-game tool gives: blunder rate by opening, by game phase, by time pressure,
accuracy trends over time, and a computed archetype.

Status: under construction. Phase 0 (scaffold) is in place; the engine
wrapper, worker pool, and product surfaces arrive phase by phase.

## Development

Requires Node 20+ and Docker.

```
npm ci          # install
npm test        # vitest across all packages
npm run lint    # eslint
npm run typecheck
npm run synth   # cdk synth of the control stack
docker compose up   # local queue (elasticmq) and table (dynamodb-local)
```

## License

This repository's code is MIT licensed. The Stockfish chess engine is GPLv3,
developed by the Stockfish community, and runs strictly as a separate process;
it is never linked into this code and never vendored into this repository.
See docs/NOTICE and https://github.com/official-stockfish/Stockfish.
