# Costs: how forked fits the AWS always-free tier

Everything below is sized against the always-free allowances: DynamoDB
25 RCU + 25 WCU provisioned, Lambda 1M requests + 400k GB-seconds/month,
SQS 1M requests, CloudWatch 10 alarms, SNS email. The one thing that is NOT
always-free is ECR image storage for the worker image (about 0.6GB at
$0.10/GB-month, so pennies). Run `cdk gc` occasionally to drop old images.

## DynamoDB budget: 20/20 table + 5/5 gsi1 = exactly 25/25

The table is PROVISIONED on purpose. On-demand bills per request, so a
runaway loop costs money; provisioned just throttles, and throttles page
via the Read/WriteThrottleEvents alarms.

Item sizes that matter: a game item is ~1-3KB (moves list), a job item
~2-6KB (ring + partial aggregates, later the wrapped summary), an engine
record ~4-12KB (per-ply evals). 1 WCU writes 1KB; 1 RCU reads 4KB strongly
consistent (double for transactions, halve for eventually consistent).

The gsi1 index projects only jobId/username/status (INCLUDE, not ALL), so
counter and ring updates to job items do NOT replicate into the GSI; its
5 WCU only pay when a job enters or leaves analyzing status.

| Path | Reads | Writes | Steady rate |
|---|---|---|---|
| POST /ingest (N games) | N cache Gets (~N RCU) + 1 budget read | rate + lock + job (~5 WCU) + N game puts (~2-3 WCU each) | burst, once per job |
| Worker game completion | job ring Get, cache Get (~3 RCU) | engine-record put (~5-10 WCU) + txn game+job (2x cost; up to ~15 WCU late in a big job as the job item grows) + metrics ADD + 2 GB-seconds ADDs (Lambda path) | ~0.05 games/s at concurrency 5 -> a few WCU/s worst case |
| GET /job/:id poll | 1 Get (~1-2 RCU) | none | ~0.5-1 RCU/s per viewer at 2s |
| Finalize (100 games) | full game Query + engine BatchGet (~100-200 RCU) | wrapped write (~6 WCU) + leaderboard Query + 2 conditional writes | burst, once per job |
| Janitor sweep | sparse GSI Query (~0 when healthy) | repairs only on drift | ~0 |
| GET /leaderboard | 1 Query (~1-2 RCU) | none | per page view |
| GET /metrics | 1 Get | none | per landing view |

## Gate (c) arithmetic: one 100-game job + one polling viewer

- Ingest burst: ~250 WCU over a few seconds. Provisioned throughput accrues
  300 seconds of burst credits (20 WCU/s x 300s = 6000 WCU), so the batch
  writes absorb cleanly; the SDK retries anything throttled.
- Steady state while analyzing: ~1.7 WCU/s measured at Lambda concurrency 5
  (engine-record puts dominate; ~0.35 WCU/s per concurrent worker), plus
  viewer polls ~1 RCU/s. An order of magnitude under 20/20.
- Finalize burst: ~200 RCU in one shot, again inside burst credits.

Measured on deploy day (gate c, 2026-07-08, 63-game erik job, us-east-1):
ingest peak 168 WCU/min; steady 95-103 WCU/min while analyzing; finalize
peak 174 RCU/min; gsi1 at or under 2 WCU/min throughout; zero throttle
events. If a future run disagrees with this table, the table is wrong:
correct it (that check is deploy gate (c), see deploy.md).

## Lambda GB-seconds

The worker function is 1769MB (exactly one vCPU). A 60s game costs
~104 GB-s; 400k GB-s/month is ~3800 such games. The router budgets 300k
(GB_SECONDS_BUDGET) for the worker and routes everything to the container
queue past it; the remaining ~100k covers api/janitor/dlq invocations,
which are small (512MB and below, mostly sub-second) and deliberately not
metered by the counter.

## SQS / CloudWatch / SNS

One message per analyzed game plus janitor requeues: thousands of requests
per month against a 1M allowance. 8 alarms of the 10 free. SNS email is free
at this volume.
