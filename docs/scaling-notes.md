# Scaling & AI-age development notes (2026-07-11 research pass)

From a web-research agent pass (AWS docs, Fowler, Pragmatic Engineer, Honeycomb,
DeBrie, web.dev — sources linked in the session transcript). Implemented items are
marked; the rest are recommendations with triggers, deliberately NOT built yet.

## Already implemented (this session)
- Cache-Control headers: leaderboard/metrics `public, s-maxage=60, stale-while-revalidate=300`,
  job status `private, max-age=1` (control app.ts — takes effect on next deploy).
- Job ETA: status payload returns `etaSeconds` from observed throughput; progress page
  shows "about N min left".
- Web poll backoff: report + progress polls back off to 5s after 60s.
- Golden-record determinism test (shared/test/golden.test.ts): classification math is
  pinned; any silent change to classify/accuracy fails CI.

## Already satisfied by the current architecture (do not rebuild)
SQS + two worker fleets with DLQ, conditional-transaction idempotency + janitor recount,
provisioned DynamoDB with cost model (docs/costs.md), per-IP rate limits, single-table +
modular monolith, content-addressed engine-record cache.

## Recommended next, in order (with triggers)
1. CloudFront in front of the Function URL (~half a day CDK) — do before any launch/post
   that could spike traffic; headers above make it effective immediately.
2. CloudWatch alarm on ApproximateAgeOfOldestMessage for both queues (15 min) — "users
   are waiting" signal; also the future trigger for container-worker autoscaling.
3. Soft-fail chess.com: serve the DynamoDB month cache with a notice when upstream 5xxs.
4. One wide structured completion log line per game (duration, nodes, cache-hit,
   queue-wait, fleet) — queryable in Logs Insights, no new infra.
5. Pre-render the share-card PNG to S3 at finalize with immutable cache headers —
   makes the viral path a CDN event, not a load event.
6. Per-job games cap (newest N months first) — one legit 20k-game archive is a bigger
   cost event than any abuser.
7. DynamoDB capacity: revisit only when throttle alarms fire on 3 separate days in a
   month; bump provisioned units before considering on-demand.

## AI-age process (repo-specific)
- The kill-test suite is the merge gate for AI-written worker/control changes: agents run
  the relevant scripts/local kill-test and paste output before approval.
- Mine review catches into CLAUDE.md invariants (~50 lines max): free-tier budget,
  completion idempotency, engine determinism/pinning, no-accounts privacy model,
  no-commit rule.
- Streaming-feel progress: surface per-game completions into the story as they land
  (ring data already carries them) — frontend-only, turns the wait into the product.
