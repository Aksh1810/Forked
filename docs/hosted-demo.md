# Hosted demo: operating notes

Notes for running the public instance. None of this applies to self-hosters.

## Standing configuration

- Deployed per `docs/deploy.md` with `-c alarmEmail=<real inbox>`; the SNS
  confirmation must be clicked or every alarm is a no-op.
- Web on Vercel with `NEXT_PUBLIC_API_BASE` set to the stack's `ApiUrl`
  output. Redeploy the web app after any stack replacement (the URL changes
  if the api function is recreated).
- A home-box container worker should be running most of the time: long games
  route to the container queue, and with no consumer they sit until the
  1-hour queue-age alarm fires. That alarm doubles as the "home worker is
  down" page.

## When alarms fire

| Alarm | Usual meaning | First move |
|---|---|---|
| DlqNotEmpty | a poison game exhausted 5 receives | read the DLQ consumer logs; the game is already marked failed, the job completed without it |
| WorkerErrors / ApiErrors / JanitorErrors / DlqConsumerErrors | code or config regression | CloudWatch logs for the function, most recent invocation |
| ContainerQueueStalled | home worker offline | start it; the queue drains, nothing was lost |
| TableRead/WriteThrottled | sustained load beyond 25/25 | check for an abuse pattern first; capacity is deliberately fixed |

## Abuse levers

- Everything is rate limited per IP per day already (analyses via
  `RATE_PER_DAY`, opt-outs at 20). To tighten globally, redeploy with a lower
  `RATE_PER_DAY`.
- The GB-seconds budget guard self-limits Lambda spend: past
  `GB_SECONDS_BUDGET` the fleet goes container-only and the product degrades
  to slower, not broken.
- Provisioned capacity is the backstop: overload throttles and alarms, it
  never bills.
- To de-list a leaderboard entry (someone else's request, moderation, etc.):
  `curl -X POST <ApiUrl>/leaderboard/remove -H 'content-type: application/json' -d '{"username":"..."}'`.
  Removal is permanent across re-analyses.

## Hygiene

- `npx cdk gc --unstable=gc` now and then: old worker images in ECR are the
  only recurring cost.
- The current UTC month is never cached from chess.com, so a user's "resync"
  refetches only that month; no cache invalidation is ever needed.
- The table is RETAIN: stack teardown keeps user data on purpose. Deleting it
  is a deliberate manual act.
