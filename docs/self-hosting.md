# Self-hosting forked

Two ways to run your own: entirely on one machine, or on your own AWS account
at effectively zero recurring cost. Everything is the same codebase either
way; the cloud pieces are just where the queue, table, and workers live.

## Option 1: one machine, no cloud

Requires Node 20+ and either Docker or Java 17+ (for the JVM stand-ins).

```
git clone <your fork>
npm ci && npx tsc -b

# stand-in queue + table (pick one):
docker compose up                        # containers
node scripts/local/jvm-stack.mjs up      # plain JVM jars, no Docker

# the services:
npm run api -w packages/control          # control API on :8787
node packages/worker/dist/main.js        # a worker; run N of these for N-way parallelism
npm run dev -w packages/web              # web on :3000
```

Workers need a Stockfish binary: either `apt install stockfish` /
`brew install stockfish` and set `STOCKFISH_PATH`, or run the worker via its
Docker image (`packages/worker/Dockerfile`), which downloads the pinned
release at build time. Analysis is deterministic per engine version, so
matching the pinned version (see `packages/shared/src/config.ts`) keeps your
cache keys consistent with the Dockerfile builds.

### Environment variables

| Variable | Used by | Default |
|---|---|---|
| TABLE_NAME | all | `forked` |
| AWS_REGION | all | `us-east-1` |
| DYNAMO_ENDPOINT / SQS_ENDPOINT | all | unset (real AWS); set to the local stack |
| QUEUE_NAME / DLQ_NAME | worker, control | `analysis-tasks` / `analysis-tasks-dlq` |
| LAMBDA_QUEUE_NAME | control | unset (everything routes to the container queue) |
| GB_SECONDS_BUDGET / ESTIMATED_NPS | control | `300000` / `350000` |
| NODE_BUDGET | control | `600000` engine nodes per position |
| MAX_GAMES_PER_JOB | control | `500` |
| RATE_PER_DAY | control | `5` analyses per username+IP per day |
| CONTACT_EMAIL | control | yours; goes in the chess.com User-Agent, per their etiquette |
| STOCKFISH_PATH | worker | `stockfish` on PATH |
| WORKER_MODE | worker | `worker`; set `dlq` to run the dead-letter consumer |
| PORT / JANITOR_MS | control local server | `8787` / `30000` |
| NEXT_PUBLIC_API_BASE | web | `http://localhost:8787` |

Set `CONTACT_EMAIL` to your own address. chess.com asks that automated
clients identify themselves with a reachable contact, and this project
follows their etiquette strictly (serial requests, permanent caching of
finished months).

## Option 2: your own AWS account

Follow `docs/deploy.md`: `cdk bootstrap`, `cdk deploy -c alarmEmail=you@...`,
confirm the SNS email, point `NEXT_PUBLIC_API_BASE` at the `ApiUrl` output,
and deploy `packages/web` anywhere that runs Next.js (Vercel free tier
works). The stack is sized to the always-free tier; `docs/costs.md` shows the
arithmetic and the one honest exception (ECR image storage, pennies).

The container queue is drained by workers YOU run, anywhere: a home server, a
spare laptop, a free-tier VM. Give that machine an IAM user restricted to the
table and the container queue (the exact policy is in `docs/deploy.md`), run
the worker image, and long games route to it automatically while short games
ride the Lambda fleet.

## Operational notes

- The janitor self-heals stuck jobs every 10 minutes (30s locally). If you
  kill every worker mid-job, the job converges when workers return; that is a
  tested property, not a hope (`scripts/local/` kill tests).
- The leaderboard is opt-out by design; `POST /leaderboard/remove` hides a
  username and survives later re-analysis.
- Rate limits are per username+IP per day (`RATE_PER_DAY`), and the
  leaderboard opt-out endpoint is capped at 20/day/IP.
- To wipe local state: stop the JVM stack and delete
  `dynamodb-local-metadata.json` plus the stack's data dir, or just recreate
  the table (the harness `ensureTable()` recreates it on next gate run).
